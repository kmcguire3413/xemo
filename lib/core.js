String.prototype.format = function () {
    var args = arguments;
    return this.replace(/\{\{|\}\}|\{(\d+)\}/g, function (m, n) {
        if (m == "{{") { return "{"; }
        if (m == "}}") { return "}"; }
        return args[n];
    });
};

Date.prototype.adjustdatebyfphours = function (h) {
    this.setTime(this.getTime() + (h * 60.0 * 60.0 * 1000.0));
    if (isNaN(this.getTime())) {
        throw new Error('Adjustment of date by floating-point hours produced invalid date.');
    }
    return this;
}

Date.prototype.clone = function () {
    return new Date(this.getTime());
}

function update_calender() {
    var year = parseInt(i_year.value);
    var month = parseInt(i_month.value);
    var group = parseInt(i_group.value);
    //render_calender(year, month, group);

    var config = {}
    config.incpayper12hrshift = 25.0;
    config.incpayperhour = 2.0;
    config.transportpay = 25.0;
    config.numtransportswaived = 1;
    config.fulltimehours = 40.0;
    config.parttimehours = 20.0;

    plugin_pay_bootstrap(
        '0767', year, 1, 1, 6, year, 7, 1, 6, group,
        config,
        function (master) {
            $('#calarea').append(JSON.stringify(master, null, 4));
        }
    );
}

function decyearmonth(year, month) {
    if (month - 1 == 0) {
        --year;
        month = 12;
        return { year: year, month: month };
    }

    return { 'year': year, 'month': month - 1 };
}

function plugin_incentivepay_init() {

}

function isDispositionATransport(dis) {
    // 5: no transport
    // 6: cancelled
    // 7: fd call
    // 9: no pt found                
    if (dis == 5 || dis == 6 || dis == 7 || dis == 9) {
        return false;
    }
    return true;
}            

function permutate(array, callback) {
    // Do the actual permuation work on array[], starting at index
    function p(array, index, callback) {
        // Swap elements i1 and i2 in array a[]
        function swap(a, i1, i2) {
            var t = a[i1];
            a[i1] = a[i2];
            a[i2] = t;
        }

        if (index == array.length - 1) {
            callback(array);
            return 1;
        } else {
            var count = p(array, index + 1, callback);
            for (var i = index + 1; i < array.length; i++) {
                swap(array, i, index);
                count += p(array, index + 1, callback);
                swap(array, i, index);
            }
            return count;
        }
    }

    if (!array || array.length == 0) {
        return 0;
    }

    return p(array, 0, callback);
}

function enumeratehoursbyid(shifts, pps, ppe, id) {
    var totalhours = 0.0;
    for (var i = 0; i < shifts.length; ++i) {
        if (shifts[i].start < pps || shifts[i].start >= ppe) {
            continue;
        }

        if (shifts[i].allocatedfor != null) {
            if (shifts[i].allocatedfor.id == id) {
                var totalshifthours = (shifts[i].end - shifts[i].start) / 1000.0 / 3600.0;
                totalhours += totalshifthours;                
            }
        }
    }

    return totalhours;
}

function objtostr(obj, pad) {
    var out = [];
    pad = pad || '';
    for (var k in obj) {
        out.push(pad + k + ': ' + obj[k]);
    }
    return out.join('\n');
}

/*
    This pay system tries to allocate hourly time up to a `cap`/limit for the personnel
    specified by the `pid`. It uses a reasonable algorithm that is not too greedy and
    chaotic or silly.
*/
function system_hourly_withcap(params) {
    var shifts = params.shifts;
    var cur_pp_start = params.cur_pp_start;
    var cur_pp_end = params.cur_pp_end;
    var cap = params.cap;
    var pid = params.pid;
    var calls = params.calls;

    var allocationid = params.allocationid || undefined;
    if (params.allownonstdhours == undefined) {
        params.allownonstdhours = true;
    }
    var magnetichour = params.magnetichour;
    if (params.avoidspecial) {
        params.avoidspecial = false;
    }
    var avoidspecial = params.avoidspecial;
    var stdhoursbegin = params.stdhoursbegin || 6;
    var stdhoursend = params.stdhoursend || 14;
    var stddaysbegin = params.stddaysbegin || 1;
    var stddaysend = params.stddaysend || 5;
    var note = params.note;
    if (params.skipstdhours == undefined) {
        params.skipstdhours = false;
    }
    if (params.adaptive == undefined) {
        params.adaptive = false;
    }
    var adaptive = params.adaptive;

    __log(10, 'HOURS-ALLOCATOR adaptive:{4} id:{2} note:{3} for {0} to {1}<br/>'.format(cur_pp_start, cur_pp_end, allocationid, note, adaptive));

    // The best reasonable hours allocator.
    function __adaptive(allocated, totalhours, pps, ppe) {
        var dayhours = [0, 0, 0, 0, 0, 0, 0];
        var dayshifts = [[], [], [], [], [], [], []];
        for (var i = 0; i < shifts.length; ++i) {
            if (shifts[i].start < pps || shifts[i].start >= ppe) {
                continue;
            }

            if (shifts[i].allocatedfor != null) {
                continue;
            }

            if (shifts[i].pid != pid) {
                continue;
            }

            var shift_end;
            if (shifts[i].end > ppe) {
                // If the shift actually goes past the end of this pay period
                // then we need to limit it just to this pay period in order
                // not to pull hours out of the next pay period which would be
                // incorrect.
                //
                // I am cloning this to be safe incase it gets altered.
                shift_end = ppe.clone();
            } else {
                shift_end = shifts[i].end;
            }                 

            var dayndx = Math.floor((shifts[i].start - pps) / 1000.0 / 3600.0 / 24.0);
            __log(10, 'dayndx:' + dayndx + ' start:' + shifts[i].start + ' pp_start:' + cur_pp_start + '<br/>');
            dayhours[dayndx] += (shift_end - shifts[i].start) / 1000.0 / 3600.0;
            // Keep this around so we can remove it from shifts if needed later.
            shifts[i].__ndx = i;
            // Modify the end time to suit our purposes.
            shifts[i].__end = shift_end;
            if (!(dayndx >= 0 && dayndx <= 6)) {
                throw new Error('The day index for pay period failed to calculate.');
            }
            // Link it into the appropriate day in order.
            dayshifts[dayndx].push(shifts[i]);
        }

        // Determine if all hours will be consumed to feed the cap?
        var tmp = 0;
        for (var i = 0; i < dayhours.length; ++i) {
            tmp += dayhours[i];
        }

        if (tmp + totalhours <= cap) {
            // There is no need to continue. We must consider all remaining shifts
            // as employee hours and not incentive hours.
            for (var i = 0; i < dayshifts.length; ++i) {
                for (var x = 0; x < dayshifts[i].length; ++x) {
                    // Remove it from ever being computed for incentive time.
                    allocated.push({
                        'start':          dayshifts[i][x].start.clone(),
                        'end':            dayshifts[i][x].end.clone(),
                        '__shift':        dayshifts[i][x],
                    });
                    __log(10, 'only ' + (tmp + totalhours) + ' in pay period.. no need for premutation algo.. took all remaining hours and shifts..<br/>');
                    if (tmp + totalhours == cap) {
                        dayshifts[i][x].allocatedfor = {
                            'system': 'hourly_withcap',
                            'cap': cap,
                            'non-standard-hours': true,
                            'id': allocationid,
                            'note': note
                        };
                    } else {
                        dayshifts[i][x].allocatedfor = {
                            'system': 'hourly_withcap',
                            'cap': cap,
                            'non-standard-hours': true,
                            'id': allocationid,
                            'note': note
                        };                          
                    }
                }
            }
            return tmp + totalhours;
        }

        var tmp = 0;
        var fiddle = 8;
        while (totalhours + tmp < cap) {
            tmp = 0;
            for (var x = 0; x < dayhours.length; ++x) {
                if (dayhours[x] >= fiddle) {
                    tmp += fiddle;
                } else {
                    tmp += dayhours[x];
                }
            }

            if (totalhours + tmp >= cap) {
                break;
            }

            ++fiddle;
        }

        __log(10, 'fiddle set to ' + fiddle + '<br/>');

        /*
        function cycle(limits, cb) {
            var cur = [];
            for (var x = 0; x < limits.length; ++x) {
                cur.push(0);
            }

            function increment(limits, cur) {
                for (var x = 0; x < cur.length; ++x) {
                    if (cur[x] + 1 <= limits[x]) {
                        ++cur[x];
                        return cur;
                    }
                    cur[x] = 0;
                }
                return null;
            }

            while (cur != null) {
                cb(cur);
                cur = increment(limits, cur);
            }

        }

        var need = cap - totalhours;
        var slack = need - Math.floor(need)

        __log(10, 'SLACK IS ' + slack);

        // Prebuild the begin and end time for all the window sizes and offsets
        // that we may use.
        var shiftslidecache = [];
        var __count = 0;
        for (var x = 0; x < dayshifts.length; ++x) {
            shiftslidecache.push({});
            ++__count;
            //for (var windowsize = 1; windowsize < dayhours[x]; ++windowsize) {
            var level = 1;
            while ( ((level & 1) * slack) + (level >> 1) <= dayhours[x] ) {
                var windowsize = ((level & 1) * slack) + (level >> 1);
                __log(10, '  level:{0} windowsize:{1}'.format(level, windowsize));
                ++level;
                if (windowsize == 0) {
                    continue;
                }
                //__log(10, 'dayhours[{0}]: {1}'.format(x, dayhours[x]));
                shiftslidecache[x][windowsize] = {};
                ++__count;
                var maxoffset = dayhours[x] - windowsize;
                for (var offset = 0; offset <= maxoffset; ++offset) {
                    function __offsetIntoShiftArrayForLength(sarray, offset, windowsize) {
                        var __offset = offset;
                        function __offsetIntoShiftArray(sarray, offset, z) {
                            if (offset > 0) {
                                var offsetrem = offset;
                                for (; z < sarray.length; ++z) {
                                    var result = sarray[z].offsetintoshift(offsetrem);

                                    if (result[0] == 1) {
                                        //__log(10, '     @ ate whole shift and done');
                                        if (z + 1 >= sarray.length) {
                                            return [sarray[z].end.clone(), 0, z];
                                        }
                                        // Ate whole shift and done.
                                        return [sarray[z+1].start.clone(), 0, z];
                                        break;
                                    }

                                    if (result[0] == 2) {
                                        //__log(10, '     @ ate partial amount of shift');
                                        // Ate partial amount of shift.
                                        return [result[1], offsetrem, z];
                                    }

                                    // More to go..
                                    offsetrem -= result[1];
                                    //__log(10, '     @ ' + offsetrem + ' more to go');
                                }

                                return [undefined, offsetrem, z];
                            }

                            return [sarray[0].start.clone(), 0, 0];
                        }

                        //__log(10, 'doing first offset into shift array');
                        //__log(10, 'offset: ' + offset);
                        //__log(10, 'windowsize: ' + windowsize);
                        var result1 = __offsetIntoShiftArray(sarray, offset, 0);
                        //__log(10, '    got offset of ' + result1[1]);
                        //__log(10, '    doing second offset into shift');
                        var result2 = __offsetIntoShiftArray(sarray, windowsize + result1[1], result1[2]);
                        if (result1[0] == undefined) {
                            throw new Error('The shift array did not have enough hours?');
                        }
                        return [result1[0], result2[0]];
                    }

                    var result = __offsetIntoShiftArrayForLength(dayshifts[x], offset, windowsize);

                    if (dayshifts[x].length > 0) {
                        if (dayshifts[x][0].start.getFullYear() == 2015 &&
                            dayshifts[x][0].start.getMonth() == 5 &&
                            dayshifts[x][0].start.getHours()== 6) {
                            __log(10, '@@ result[0]:{0}\nwindowsize:{1}\noffset:{2}'.format(
                                result[0], windowsize, offset
                            ));
                        }
                    }

                    shiftslidecache[x][windowsize][offset] = result;
                    ++__count;
                }
                if (Math.floor(dayhours[x]) != dayhours[x]) {
                    // Get that one extra offset that is less than an hour.
                    var result = __offsetIntoShiftArrayForLength(
                        dayshifts[x], dayhours[x] - windowsize, windowsize
                    );
                    shiftslidecache[x][windowsize][dayhours[x] - windowsize] = result;
                    ++__count;
                }
            }
            if (dayshifts[x].length > 0) {
                shiftslidecache[x][dayhours[x]] = {};
                shiftslidecache[x][dayhours[x]][0] = [
                    dayshifts[x][0].start,
                    dayshifts[x][dayshifts[x].length - 1].end
                ];
            }
        }

        for (var x = 0; x < dayhours.length; ++x) {
            __log(10, '     dayhours[{0}]: ' + dayhours[x]);
        }

        __log(10, 'shiftslidecache dump ' + pps);
        for (var x = 0; x < shiftslidecache.length; ++x) {
            for (var y in shiftslidecache[x]) {
                for (var z in shiftslidecache[x][y]) {
                    __log(10, 'x:{0} windowsize:{1} offset:{2} value:{3}'.format(
                        x, y, z, shiftslidecache[x][y][z]
                    ));
                }
            }
        }


        // Old benchmark check.
        //alert('shiftslidecache.__count:' + ++__count);

        //cycle(dayhours, function (cur) {
        for (var x = 0; x < dayhours.length; ++x) {
            var slidecache = shiftslidecache[x];
            for (var windowsize in slidecache) {
                for (var offset in slidecache[windowsize]) {
                    var pair = slidecache[windowsize][offset];
                    var begintime = pair[0];
                    var endtime = pair[1];

                    var transportsgot = 0;

                    for (var z = 0; z < calls.length; ++z) {
                        var calldate = new Date(calls[z][1] * 1000.0);
                        var calldis = calls[z][3];
                        if (isDispositionATransport(calldis)) {
                            if (calldate >= begintime && calldate < endtime) {
                                alert('YES');
                                for (var y = 0; y < dayshifts[x].length; ++y) {
                                    if (calldate >= dayshifts[x][y].start && calldate < dayshifts[x][y].end) {
                                        ++transportsgot;
                                    }
                                }
                            }
                        }
                    }

                    slidecache[windowsize][offset] = transportsgot;
                }
            }
        }

        // This enables days to be entirely skipped.
        shiftslidecache[0][0] = {'0': 0};
        shiftslidecache[1][0] = {'0': 0};
        shiftslidecache[2][0] = {'0': 0};
        shiftslidecache[3][0] = {'0': 0};
        shiftslidecache[4][0] = {'0': 0};
        shiftslidecache[5][0] = {'0': 0};
        shiftslidecache[6][0] = {'0': 0};      

        var best = undefined;
        var best_hours = 0;
        var best_transports = 9999;
        var worst_transports = 0;

        __log(10, 'trying combinations');

        function try_score(hours, transports, combid) {
            if (hours + totalhours > cap) {
                // Do not retain this combination. It exceeds capacity.
                return;
            }

            if (hours < best_hours) {
                return;
            }

            if (hours == best_hours) {
                if (best_transports <= transports) {
                    worst_transports = transports;  
                    return;
                }
            }

            best_hours = hours;
            best_transports = transports;
            best = combid;
        }

        var trycount = 0;

        //throw new Error('DEBUG STOP');

        for (var ws0 in shiftslidecache[0]) {
            for (var o0 in shiftslidecache[0][ws0]) {
                for (var ws1 in shiftslidecache[1]) {
                    for (var o1 in shiftslidecache[1][ws1]) {
                        for (var ws2 in shiftslidecache[2]) {
                            for (var o2 in shiftslidecache[2][ws2]) {
                                for (var ws3 in shiftslidecache[3]) {
                                    for (var o3 in shiftslidecache[3][ws3]) {
                                        for (var ws4 in shiftslidecache[4]) {
                                            for (var o4 in shiftslidecache[4][ws4]) {
                                                for (var ws5 in shiftslidecache[5]) {
                                                    for (var o5 in shiftslidecache[5][ws5]) {
                                                        for (var ws6 in shiftslidecache[6]) {
                                                            for (var o6 in shiftslidecache[6][ws6]) {
                                                                var totaltransports =
                                                                    shiftslidecache[0][ws0][o0] +
                                                                    shiftslidecache[1][ws1][o1] +
                                                                    shiftslidecache[2][ws2][o2] +
                                                                    shiftslidecache[3][ws3][o3] +
                                                                    shiftslidecache[4][ws4][o4] +
                                                                    shiftslidecache[5][ws5][o5] +
                                                                    shiftslidecache[6][ws6][o6];                                               
                                                                var _ws0 = parseFloat(ws0);
                                                                var _ws1 = parseFloat(ws1);
                                                                var _ws2 = parseFloat(ws2);
                                                                var _ws3 = parseFloat(ws3);
                                                                var _ws4 = parseFloat(ws4);
                                                                var _ws5 = parseFloat(ws5);
                                                                var _ws6 = parseFloat(ws6);
                                                                //var _o0 = parseInt(o0);
                                                                //var _o1 = parseInt(o1);
                                                                //var _o2 = parseInt(o2);
                                                                //var _o3 = parseInt(o3);
                                                                //var _o4 = parseInt(o4);
                                                                //var _o5 = parseInt(o5);
                                                                //var _o6 = parseInt(o6);
                                                                var tothours = _ws0 + _ws1 + _ws2 + _ws3 + _ws4 + _ws5 + _ws6;
                                                                try_score(tothours, totaltransports,
                                                                    [
                                                                        ws0, o0, ws1, o1, ws2, o2, ws3, o3, ws4, o4,
                                                                        ws5, o5, ws6, o6
                                                                    ]
                                                                );
                                                                ++trycount;
                                                            }
                                                        }
                                                    }
                                                }                                                    
                                            }
                                        }
                                    }
                                }                                    
                            }
                        }                            
                    }
                }
            }
        }

        __log(10, '    best_hours:{0} best_transports:{1} worst_transports:{2} trycount:{3}'.format(
            best_hours,
            best_transports,
            worst_transports,
            trycount
        ));

        if (worst_transports > 0) {
            throw new Error("WOWOWOWOWOW");
        }

        //});
        */

        var bestmap = null;
        var bestcount = -1;
        var besthours = -1;

        /*
        __log(10, 'DAYSHIFTS DUMP');
        for (var ndx = 0; ndx < dayshifts.length; ++ndx) {
            for (var y = 0; y < dayshifts[ndx].length; ++y) {
                var shift = dayshifts[ndx][y];
                __log(10, '   dayshifts[{0}][{1}] start:{2} end:{3}'.format(
                    ndx, y, shift.start, shift.end
                ));
            }
        }
        */

        function work_premutate_map(p, pretend) {
            var transportcount = 0;
            var toinsert = {};
            var curhoursgot = 0;
            for (var x = 0; x < p.length; ++x) {
                var ndx = p[x];
                // Try to take 8 hours minimum and maximum.
                for (var y = 0; y < dayshifts[ndx].length; ++y) {
                    var shift = dayshifts[ndx][y];
                    var totalshifthours = (shift.__end - shift.start) / 1000.0 / 3600.0;
                    var need = cap - (curhoursgot + totalhours);
                    if (need <= 0) {
                        break;
                    }
                    // The fiddle will cap the maximum hours to grab.
                    if (need > fiddle) {
                        need = fiddle;
                    }

                    var s_start;
                    var s_end;
                    if (totalshifthours > need) {
                        curhoursgot += need;
                        // What would we have made in incentive? Find all calls
                        // inside the remaining shift.
                        s_end = shift.start.clone();
                        s_end.setHours(s_end.getHours() + need);
                        s_start = shift.start;

                        if (!pretend) {
                            __log(10, 'B. took {0} hours from {1} to {2}<br/>'.format(need, shift.start, shift.end));
                            var nshift = shift.clone();
                            
                            // The magnetic hour trys to move the time as close
                            // as possible to the specified hour. I wrote the
                            // code this way to reduce duplicate code and to
                            // keep from changing existing code as much as 
                            // possible.
                            if (magnetichour == undefined) {
                                magnetichour = shift.start.getHours() + 1;
                            }

                            var magused;

                            if (shift.start.getHours() >= magnetichour) {
                                // The original code.
                                nshift.start.adjustdatebyfphours(need);
                                shift.end = nshift.start.clone();
                                toinsert[shift.__ndx + 1] = nshift;
                                magused = false;
                            } else {
                                // The actual magnetic hour code.
                                nshift.start = nshift.end.clone();
                                nshift.start.adjustdatebyfphours(-need);
                                shift.end = nshift.start;
                                toinsert[shift.__ndx + 1] = nshift;

                                var tmp = shift; // =unused shift
                                shift = nshift;  // =used shift
                                nshift = tmp;    // =unused shift

                                // now shift pointing to newly created
                                // shift to be inserted after original
                                // shift entry.. now the code below
                                // will execute correctly
                                magused = true;
                            }

                            
                            //nshift.start.setHours(shift.start.getHours() + need);
                            allocated.push({
                                'start':          shift.start.clone(),
                                'end':            shift.end.clone(),
                                '__shift':        shift,
                            });

                            nshift.allocatedfor = null;
                            shift.allocatedfor = {
                                'system': 'hourly_withcap',
                                'cap': cap,
                                'non-standard-hours': true,
                                'adaptive-score': bestcount,
                                'id': allocationid,
                                'note': note,
                                'magnetic-hour-used': magused
                            };
                        }                                     
                    } else {
                        curhoursgot += totalshifthours;
                        // We are going to just remove the entire shift.
                        if (!pretend) {
                            __log(10, 'B. took all hours from {0} to {1}<br/>'.format(shift.start, shift.end));
                            allocated.push({
                                'start':          shift.start.clone(),
                                'end':            shift.__end.clone(),
                                '__shift':        shift,
                            });
                            s_start = shift.start;
                            s_end = shift.end;
                            // Make the shift equal to zero hours.
                            shift.allocatedfor = {
                                'system': 'hourly_withcap',
                                'cap': cap,
                                'non-standard-hours': true,
                                'adaptive-score': bestcount,
                                'id': allocationid,
                                'note': note,
                                'magnetic-hour-used': magused
                            };
                        }
                    }
                    // TODO:
                    // RE-ENABLE THIS
                    //
                    // THIS SLOW AS SHIT
                    //
                    // IDEA.... EARLY ON GO AHEAD AND LINK ANY CALL
                    // TO THE SHIFT IT OCCURED ON BEFORE WE START
                    // DOING ANY HOUR ALLOCATION!!
                    //
                    /*
                    for (var z = 0; z < calls.length; ++z) {
                        var calldate = new Date(calls[z][1] * 1000.0);
                        var calldis = calls[z][3];
                        if (isDispositionATransport(calldis)) {
                            if (calldate >= s_start && calldate < s_end) {
                                ++transportcount;
                            }
                        }
                    } 
                    */                   
                }
            }

            // If we are not pretending, then insert all the created
            // shifts into the proper places. We insert in descending
            // order to keep from throwing the next insert off. This
            // is why we had to wait to perform this function last.
            if (!pretend) {
                var tmp = [];
                for (var k in toinsert) {
                    tmp.push(k);
                }

                var tmpsorted = tmp.sort(function (a, b) { return b - a });

                for (var i = 0; i < tmp.length; ++i) {
                    var shift = toinsert[tmp[i]];
                    var insertat = tmp[i];
                    shifts.splice(insertat, 0, shift);
                }
            }

            return [transportcount, curhoursgot];
        }

        var map = [0, 1, 2, 3, 4, 5, 6];
        permutate(map, function(p) {
            // Work the premutate map, but just pretend to actually do it.
            var result = work_premutate_map(p, true);
            var transportcount = result[0];
            var resulthours = result[1];

            // This is a situation where we want all time allocated in the best
            // possible way to avoid the coded events, which in this case is
            // transportcount. This is used to allocate hours around transports.
            if (bestcount == -1 || (avoidspecial && (transportcount < bestcount))) {
                if (resulthours > besthours) {
                    besthours = resulthours;
                    bestcount = transportcount;
                    bestmap = p.slice();
                    __log(10, 'set-best-map:' + bestmap.join(','));
                    __log(10, 'resulthours: ' + resulthours);
                    return;
                }
            } 

            // This is a situation where we want all time allocated in the best
            // possible way to have the coded event happen during the time. so here
            // we are trying to have these happen during the times.
            if (!avoidspecial && (transportcount > bestcount)) {
                if (resulthours > besthours) {
                    besthours = resulthours;
                    bestcount = transportcount;
                    bestmap = p.slice();
                    __log(10, 'set-best-map:' + bestmap.join(','));
                    __log(10, 'resulthours: ' + resulthours);
                    return;
                }
            }
        });

        // Actually do the premutate map.
        __log(10, 'working best map with transportcount of ' + bestcount + ' for hours of ' + besthours + ' added to ' + totalhours + ' hours<br/>');
        __log(10, 'using-best-map:' + bestmap.join(','));
        var result = work_premutate_map(bestmap, false);
        __log(10, 'DBG-CHECK:' + result[1]);
        
        return totalhours + result[1]; 
    }


    // The standard hours allocator.
    function __firstfind(allocated, totalhours, pps, ppe) {
        // Break any shifts into parts between 6A and 2P
        for (var i = 0; i < shifts.length; ++i) {
            if (shifts[i].start < pps || shifts[i].start >= ppe) {
                continue;
            }

            if (shifts[i].allocatedfor != null) {
                continue;
            }

            if (shifts[i].pid != pid) {
                continue;
            }

            if (shifts[i].start.getDay() < stddaysbegin || shifts[i].start.getDay() > stddaysend) {
                // Only do days Monday through Friday.
                continue;
            }

            var bya = shifts[i].start.clone();
            bya.setHours(stdhoursbegin);
            bya.setMinutes(0);
            var byb = shifts[i].end.clone();
            byb.setHours(stdhoursend);
            byb.setMinutes(0);
            var result = shifts[i].splitbymulti([bya, byb]);
            if (result.length > 0) {
                result.splice(0, 0, 1);
                result.splice(0, 0, i);
                shifts.splice.apply(shifts, result);
                // Just over the newly inserted shifts.
                i += result.length - 3;
            }
        }

        for (var i = 0; i < shifts.length; ++i) {
            if (shifts[i].start < pps || shifts[i].start >= ppe) {
                continue;
            }

            if (shifts[i].allocatedfor != null) {
                continue;
            }

            if (shifts[i].pid != pid) {
                continue;
            }

            var shift_end = shifts[i].end;

            __log(10, 'A. for pid {0} index:{1} looking at shift {2} ... {3} to {4}<br/>'.format(pid, i, shifts[i].name, shifts[i].start, shifts[i].end));

            // We split a 6AM to 2PM so if it starts at 6 and on a weekday then we can use it.
            var shift_start_hour = shifts[i].start.getHours();
            if (
                shift_start_hour >= stdhoursbegin && shift_start_hour < stdhoursend && shifts[i].start.getDay() >= stddaysbegin && 
                shifts[i].start.getDay() <= stddaysend
            ) {
            //if (shifts[i].start.getHours() == 6 && shifts[i].start.getDay() >= 1 && shifts[i].start.getDay() <= 5) {
                // Yes. Yank out what we need to pull out.
                var totalshifthours = (shift_end - shifts[i].start) / 1000.0 / 3600.0;
                var need = cap - totalhours;
                if (need <= 0) {
                    // We do not need to continue. We have maxed out on
                    // hours set by the `cap`.
                    break;
                }
                // Lock the need to 8 hours.
                if (need > 8) {
                    need = 8;
                }
                if (totalshifthours > need) {
                    totalhours += need;

                    var nshift = shifts[i].clone();
                    nshift.start.adjustdatebyfphours(need);
                    //nshift.start.setHours(shifts[i].start.getHours() + need);
                    shifts[i].end = nshift.start.clone();

                    allocated.push({
                        'start':          shifts[i].start.clone(),
                        'end':            shifts[i].end.clone(),
                        '__shift':        shifts[i], 
                    });

                    nshift.allocatedfor = null;
                    shifts[i].allocatedfor = {
                        'system': 'hourly_withcap',
                        'cap': cap,
                        'id': allocationid,
                        'note': note
                    };

                    shifts.splice(i + 1, 0, nshift);
                    // Skip the newly inserted shift.
                    ++i;
                    __log(10, 'removed {0} hours from shift {1} to {2}<br/>'.format(need, shifts[i].start, shift_end));
                } else {
                    totalhours += totalshifthours;
                    __log(10, 'removed entire shift {0} to {1}<br/>'.format(shifts[i].start, shift_end));
                    // We are going to just remove the entire shift.
                    allocated.push({
                        'start':          shifts[i].start.clone(),
                        'end':            shifts[i].end.clone(),
                        '__shift':        shifts[i],
                    });                                
                    shifts[i].allocatedfor = {
                        'system': 'hourly_withcap',
                        'cap': cap,
                        'id': allocationid,
                        'note': note
                    };                    
                }
            }

            if (totalhours >= cap) {
                // No more exclusion for this pay period. We have reached the
                // maximum payable hours.
                break;
            }
        }

        return totalhours;
    }
    
    var gothours = enumeratehoursbyid(shifts, cur_pp_start, cur_pp_end, allocationid);
    if (gothours >= cap) {
        return {
            'total':   gothours,
            'shifts':  []
        };
    }

    var allocated = [];
    if (!adaptive) {
        gothours = __firstfind(allocated, gothours, cur_pp_start, cur_pp_end);
    } else {
        gothours = __adaptive(allocated, gothours, cur_pp_start, cur_pp_end);
    }

    __log(10, 'hourly_withcap; allocationid:{0} gothours:{1} start:{2} end:{3}'.format(
        allocationid, gothours, cur_pp_start, cur_pp_end
    ));

    return {
        'total':      gothours,
        'shifts':     allocated,
    };

    /*
    var ret = {};
    // Each pay period is two weeks. So we need to do this computation
    // twice for each week.
    var a_allocated = [];
    var tmp = cur_pp_start.clone();
    tmp.setDate(tmp.getDate() + 7);
    var totalhours = __a(a_allocated, 0.0, cur_pp_start, tmp);
    __log(10, 'A.1: total hours was {0} of {1}<br/>'.format(totalhours, cap));
    if (totalhours < cap && allownonstdhours) {
        totalhours = __b(a_allocated, totalhours, cur_pp_start, tmp);
        __log(10, 'B.1: total hours was {0} of {1}<br/>'.format(totalhours, cap));
    }

    ret['a'] = {
        'total':     totalhours,
        'shifts':    a_allocated,
        'start':     cur_pp_start.clone(),
        'end':       tmp,
    };

    var b_allocated = [];
    var tmp = cur_pp_start.clone();
    tmp.setDate(tmp.getDate() + 7);
    var totalhours = __a(b_allocated, 0.0, tmp, cur_pp_end);
    __log(10, 'A.2 total hours of was {0} of {1}<br/>'.format(totalhours, cap));
    if (totalhours < cap && allownonstdhours) {
        totalhours = __b(b_allocated, totalhours, tmp, cur_pp_end);
        __log(10, 'B.2: total hours was {0} of {1}<br/>'.format(totalhours, cap));
    }

    ret['b'] = {
        'total':     totalhours,
        'shifts':    a_allocated,
        'start':     tmp,
        'end':       cur_pp_end.clone(),
    };

    __log(10, 'doing next iteration<br/>');
    return ret;
    */
}

function warn(msg) {
    alert('A warning was issued. Please tell Kevin:\n' + msg);
}

function plugin_pay_calculator(pidattrib, calls, shifts, key, from, to, cfg, cb) {
    var master = {};

    master['systems'] = {};
    master['systems']['hourly_withcap(8)'] = {};
    master['systems']['hourly_withcap(6)'] = {};

    // pay period.. 7/9/2015 - 7/23/2015

    // First, we need to determine what pay period we are currently in.
    var pp_start = new Date(2015, 7 - 1, 9, 6);
    var pp_end = new Date(2015, 7 - 1, 23, 6);
    
    var firstdayofrange = new Date(from.year, from.month - 1, from.day, from.hour);
    var lastdayofrange = new Date(to.year, to.month - 1, to.day, to.hour);

    master['from'] = firstdayofrange;
    master['to'] = lastdayofrange;

    __log(10, '{0}-{1}-{2}'.format(to.year, to.month, to.day));
    __log(10, 'doing {0} to {1}<br/>'.format(firstdayofrange, lastdayofrange));
    __log(10, 'shifts.length:' + shifts.length + '<br/>');

    var __cache = [];

    function getpayperiodidbydate(d, half) {
        var __pp_start = pp_start.clone();
        var __pp_end = pp_end.clone();
        var tmp = new Date(2015, 4, 30, 14);
        var dbg = false;
        half = half || 0;
        if (d < __pp_start) {
            for (; d < __pp_start; __pp_start.setDate(__pp_start.getDate() - 14), __pp_end.setDate(__pp_end.getDate() - 14)) {
            }
        } else {
            // Only increment if the day is greater than the end of the currently specified pay period.
            for (; d >= __pp_end; __pp_start.setDate(__pp_start.getDate() + 14), __pp_end.setDate(__pp_end.getDate() + 14));
        }
        if (half > 0) {
            var hs = __pp_start.clone();
            var he = __pp_end.clone();
            // In this case we only do half a bi-weekly pay period which is only 7 days.
            if ((d - hs) / 1000.0 / 60.0 / 60.0 / 24.0 >= 7.0) {
                hs.setDate(hs.getDate() + 7);
            } else {
                he.setDate(he.getDate() - 7);
            }
            if (half > 1) {
                // The caller wants both 14 day periods and 7 day periods.
                return [[__pp_start, __pp_end], [hs, he]];
            }
            // The caller only wants 7 day periods.
            return [hs, he];
        }
        // The caller only wants 14 day periods.
        return [__pp_start, __pp_end];
    }

    // lock incentive calculations for personnel, who are involved in pay system
    // that is performed before incentive, to not have incentive calculated beyond
    // this specific date.
    incentive_calculation_lock_for_payperiod = getpayperiodidbydate(lastdayofrange)[0];
    __log(10, 'incentive calculation lock for pay period dependancy set at ' + incentive_calculation_lock_for_payperiod + '<br/>');

    // I feel like it was bad practice to alter these variables, but... I did
    // and it seems like it is okay, but I want to come back and cleanup later.
    var tmp = getpayperiodidbydate(firstdayofrange);
    pp_start = tmp[0];
    pp_end = tmp[1];

    var incentive_calulation_lock_for_payperiod_who = [];         
    var personnel_cap = {}       

    for (var x = 0; x < shifts.length; ++x) {
        shifts[x].events = [];
        for (var z = 0; z < calls.length; ++z) {
            var calldate = new Date(calls[z][1] * 1000.0);
            if (calldate >= shifts[x].start && calldate < shifts[x].end) {
                shifts[x].events.push({
                    type:         'ems-call',
                    date:         calldate,
                    disposition:  calls[z][3]
                });
            }
        }
    }

    // We now have `pp_start` and `pp_end` over the first day of this month. We need
    // to now enumerate our full time and part time drivers. Then we will decide what
    // shifts for them to exclude from the incentive calculations.
    for (var pid in pidattrib) {
        pid = parseInt(pid);
        var attribs = pidattrib[pid];
        var cap = null;
        for (var x = 0; x < attribs.length; ++x) {
            if (attribs[x] == 3) {
                cap = cfg.fulltimehours;
                break;
            }
            if (attribs[x] == 4) {
                cap = cfg.parttimehours;
                break;
            }
        }

        if (cap != null) {
            __log(10, 'hourly capacity of ' + cap + ' set for pid of ' + pid + '<br/>');
            incentive_calulation_lock_for_payperiod_who.push(pid);
            personnel_cap[pid] = cap;
        }
    }


    /*
        (1)     add a pay period identification for each shift which reduces
                recomputation of this in different places it is needed

        (2)     split any shift spanning a 7 day pay period
    */
    for (var i = 0; i < shifts.length; ++i) {
        var shift = shifts[i];
        var result = getpayperiodidbydate(shift.start, 2);
        var start_pp = result[1];
        shift.payperiod14 = result[0];
        shift.payperiod7 = result[1];

        if (shift.pid != null && ($.inArray(shift.pid, incentive_calulation_lock_for_payperiod_who) > -1)) {
            var result = getpayperiodidbydate(shift.end, 2);
            var end_pp = result[1];
            // See if we need to split the shift..
            if (start_pp[0].getTime() != end_pp[0].getTime()) {
                // Break the shift into two shifts.
                if (end_pp[0] - shift.end == 0) {
                    continue;
                }
                var newshift = shift.clone();
                newshift.start = start_pp[1].clone();
                newshift.payperiod14 = result[0];
                newshift.payperiod7 = result[1];
                shift.end = start_pp[0]; // ends on start pay period
                // Insert new shit after this shift.
                shifts.splice(i + 1, 0, newshift);
                // Advance index so we skip over the newly inserted shift.
                ++i;
            } 
        }                    
    }

    // APPLY THE PAY SYSTEMS FOR EACH PERSONNEL
    for (var i = 0; i < incentive_calulation_lock_for_payperiod_who.length; ++i) {
        var pid = incentive_calulation_lock_for_payperiod_who[i];
        var cap = personnel_cap[pid];

        master['systems']['hourly_withcap(8)'][pid] = [];
        master['systems']['hourly_withcap(6)'][pid] = [];

        var cur_pp_start = pp_start.clone();
        // Wack this into a 7 day pay period instead of a 14 day pay period...
        // TOOD: come back and clean all this cur...pp...start...end crap up
        var cur_pp_end = pp_start.clone();
        cur_pp_end.setDate(cur_pp_end.getDate() + 7);
        for (; cur_pp_start <= lastdayofrange; cur_pp_start.setDate(cur_pp_start.getDate() + 7), cur_pp_end.setDate(cur_pp_end.getDate() + 7)) {
            __log(10, 'doing payperiod {0} to {1}<br/>'.format(cur_pp_start, cur_pp_end));
            
            var hours5x8 = 0;
            var hours4x6 = 0;

            var param_hours5x8std = {
                'shifts':         shifts,
                'cur_pp_start':   cur_pp_start,
                'cur_pp_end':     cur_pp_end,
                'cap':            cap,
                'pid':            pid,
                'calls':          calls,
                'stdhoursbegin':  6,
                'stdhoursend':    14,
                'stddaysbegin':   1,
                'stddaysend':     5,
                'adaptive':       false,
                'allocationid':   '8x5 PAY',
                'note':           'STANDARD HOURS'                
            };

            var param_hours5x8nonstd = {
                'shifts':         shifts,
                'cur_pp_start':   cur_pp_start,
                'cur_pp_end':     cur_pp_end,
                'cap':            cap,
                'pid':            pid,
                'calls':          calls,
                'stdhoursbegin':  0,
                'stdhoursend':    24,
                'stddaysbegin':   0,
                'stddaysend':     6,
                'magnetichour':   6,
                'adaptive':       true,
                'avoidspecial':   true,   // avoid transports (special)
                'allocationid':   '8x5 PAY',
                'note':           'NON-STANDARD HOURS'
            };

            var param_hours4x6std = {
                'shifts':           shifts,
                'cur_pp_start':     cur_pp_start,
                'cur_pp_end':       cur_pp_end,
                'cap':              20,
                'pid':              pid,
                'calls':            calls, 
                'stdhoursbegin':    14,
                'stdhoursend':      18,
                'stddaysbegin':     1,
                'stddaysend':       5,
                'adaptive':         false,
                'allocationid':      '4x6 PAY',
                'note':             'STANDARD HOURS' 
            };

            var param_hours4x6nonstd = {
                'shifts':           shifts,
                'cur_pp_start':     cur_pp_start,
                'cur_pp_end':       cur_pp_end,
                'cap':              20,
                'pid':              pid,
                'calls':            calls, 
                'stdhoursbegin':    0,
                'stdhoursend':      24,
                'stddaysbegin':     0,
                'stddaysend':       6,
                'magnetichour':     6,
                'adaptive':         true,
                'avoidspecial':     true,   // avoid transports (special)
                'allocationid':      '4x6 PAY',
                'note':             'NON-STANDARD HOURS' 
            };            

            // Try to allocate hours between 6A and 2P on weekdays.
            //var ret = system_hourly_withcap(param_hours5x8std);
            //master['systems']['hourly_withcap(8)'][pid].push(ret.shifts);
            //hours5x8 += ret.total;

            // Try to allocate hours between 2P and 6P on weekdays.
            var hold4x6 = system_hourly_withcap(param_hours4x6std);
            hours4x6 += hold4x6.total;

            if (hours5x8 < cap) {
                // If we did not have enough hours, then try to allocate
                // the needed hours during any time on any day. Also, 
                // use the adaptive algorithm to try to keep certain
                // incentive generating activities on incentive time.
                var ret = system_hourly_withcap(param_hours5x8nonstd);
                master['systems']['hourly_withcap(8)'][pid].push(ret.shifts);
                hours5x8 += ret.total;
            }

            // If we still do not have enough hours we need to drop
            // our 4x6 PAY shifts and try to allocate again.
            if (hours5x8 < 40) {
                alert('dropping 4x6...');
                for (var x = 0; x < hold4x6.shifts.length; ++x) {
                    // This will make the shift free for allocation. We use
                    // the temporary __shift member. This is prefixed because
                    // it is internal usage only.
                    hold4x6.shifts[x].__shift.allocatedfor = null;
                }
                var ret = system_hourly_withcap(param_hours5x8nonstd);
                master['systems']['hourly_withcap(8)'][pid].push(ret.shifts);
                hours5x8 += ret.total;

                // Reallocate standard 4x6 if possible.
                hold4x6 = system_hourly_withcap(param_hours4x6std);
                hours4x6 = hold4x6.total;
                master['systems']['hourly_withcap(6)'][pid].push(hold4x6.shifts);
            } else {
                master['systems']['hourly_withcap(6)'][pid].push(hold4x6.shifts);
            }

            // Try to allocate non-standard 4x6..
            var result = system_hourly_withcap(param_hours4x6nonstd);
            hours4x6 = result.total;
            master['systems']['hourly_withcap(6)'][pid].push(result.shifts);
        }
    }

    //
    // THIS IS THE INCENTIVE PAY CALCULATION SYSTEM. THIS CURRENTLY HAPPENS
    // FOR ALL PERSONNEL. IF A PERSONNEL HAS ANOTHER SYSTEM THAT USES HOURS
    // THEN IT SHOULD HAVE ALREADY EXECUTED FOR THE PERSONNEL AND REMOVED 
    // THOSE HOURS.
    //
    var allpay = {};
    master['systems']['incentive'] = allpay;

    function splitshiftinplaceby(shifts, ndx, by) {
        // Only split the shift if it actually spans the time specified.
        if (shifts[ndx].start < by && shifts[ndx].end > by) {
            var newshift = shifts[ndx].clone();

            shifts[ndx].end = by;
            newshift.start = by;
            shifts.splice(ndx + 1, 0, newshift);
            return true;
        }

        return false;
    }

    function splitshiftsby(shifts, by) {
        for (var i = 0; i < shifts.length; ++i) {
            if (splitshiftinplaceby(shifts, i, by)) {
                __log(10, 'splitshiftsby for {0} on {1} and {2}'.format(
                    shifts[i].name, shifts[i].start, shifts[i+1].end
                ));
            }
        }
    }

    // Just to be safe and lessen the code complexity below we will
    // split shifts. The code below checks if the shift start is less
    // than firstdayofrange and if so then the shift is ignored. This
    // prevents that from happening. This also will break up shifts
    // but since we are sure that incentive is only desired to be
    // calculated in the range specified this is OK.
    splitshiftsby(shifts, firstdayofrange);
    splitshiftsby(shifts, lastdayofrange);

    __log(10, 'doing capitalism incentive pay calculation ' + shifts.length + '<br/>');
    for (var i = 0; i < shifts.length; ++i) {
        var shift = shifts[i];

        if (
                (shift.start < firstdayofrange && shift.end <= firstdayofrange) ||
                (shift.start >= lastdayofrange && shift.end > lastdayofrange)
            ) {                                        
            // Skip this because it is outside of the current pay period.
            continue;
        }   

        if (shift.allocatedfor != null) {
            continue;
        }

        var per_payperiod = false;
        if (shift.pid != null && ($.inArray(shift.pid, incentive_calulation_lock_for_payperiod_who) > -1)) {
            per_payperiod = true;
            // This locked the calculation of incentive to only pay periods that we have fully
            // covered with the range, but instead we will ensure that we calculate all pay
            // periods under the range for whatever systems, then do the incentive for the range.
            /*
            if (end > incentive_calculation_lock_for_payperiod) {
                // (1) This extends into a pay period that the range
                //     specified does not cover, or the range included
                //     incomplete data for the schedule.
                // (2) This personnel was locked due to a dependancy
                //     of a pay system to complete its operation in
                //     this pay period.
                // (3) The pay period could not be calculated because
                //     the range did not include it.
                // Therefore this personnel will not have incentive
                // calculated inside this pay period. So we will limit
                // the calculation up to the exact time of this pay period.
                __log(10, 'name:{0} pid:{1} shift incurred incentive calculation lock for payperiod reasons of {2} to {3} to {4}<br/>'.format(
                    name, pid, start, end, incentive_calculation_lock_for_payperiod
                ));
                end = incentive_calculation_lock_for_payperiod;
                if (end <= start) {
                    // The shift contains no time since we limited it.
                    continue;
                }
            }
            */
        }


        function curpay_init(cp) {
            cp.pid = pid;
            cp.name = shift.name;
            cp.incentivedollars = 0.0;
            cp.totalhours = 0.0;
            cp.hr12shiftscount = 0;
            cp.transportcount = 0;
            cp.paidtransportcount = 0;
            cp.callcount = 0;
            cp.slackhours = 0;
            cp.shifts = [];
            cp.transportlog = [];
        }

        // 

        // Find all calls that happen on this shift,
        var payid;
        var curpay;
        if (shift.pid != null) {
            payid = shift.pid;
        } else {
            payid = shift.name;
        }

        if (payid in allpay) {
            curpay = allpay[payid];
        } else {
            curpay = {}
            if (per_payperiod) {
                curpay.per_payperiod = true;
                curpay.pp = {};
            } else {
                curpay.per_payperiod = false;
                curpay_init(curpay);
            }
            allpay[payid] = curpay;
        }

        if (per_payperiod) {
            if (!(shift.payperiod14[0] in curpay.pp)) {
                curpay.pp[shift.payperiod14[0]] = {};
                curpay_init(curpay.pp[shift.payperiod14[0]]);
            }
            // Redirect into sub-bucket for per_payperiod == true.
            curpay = curpay.pp[shift.payperiod14[0]];
        }

        var dbg = curpay.incentivedollars;

        // How many twelve hour shifts do we have in this shift?
        var hours = (shift.end - shift.start) / 1000.0 / 60.0 / 60.0;

        if (hours < 0.0) {
            warn('The hours for a shift entry showed a starting time before and ending time!');
        }

        curpay.totalhours += hours;
        
        var hr12shifts = Math.floor(hours / 12.0);
        var lefthours = hours - hr12shifts * 12.0;
        curpay.slackhours += lefthours;
        curpay.hr12shiftscount += hr12shifts;
        curpay.incentivedollars += cfg.incpayper12hrshift * hr12shifts;
        curpay.incentivedollars += cfg.incpayperhour * lefthours;

        // Add data to just the specific shift.
        shift.info_incentive = {};
        shift.info_incentive.dollars = cfg.incpayper12hrshift * hr12shifts + cfg.incpayperhour * lefthours;        

        var numcalls = 0;
        var numtransports = 0;
        for (var x = 0; x < calls.length; ++x) {
            var id = calls[x][0];
            var dt = parseInt(calls[x][1]) * 1000.0;
            var crewid = calls[x][2];
            var dis = calls[x][3];
            dt = new Date(dt);
            if (dt >= shift.start && dt < shift.end) {
                ++numcalls;
                if (isDispositionATransport(dis)) {
                    ++numtransports;
                    curpay.transportlog.push({
                        'datetime':          dt,
                    });
                }
            } 
        }

        curpay.shifts.push({ 
            'start':         shift.start.clone(),
            'end':           shift.end.clone(),
            'hours':         (shift.end - shift.start) / 1000.0 / 60.0 / 60.0,
        });

        curpay.callcount += numcalls;
        curpay.transportcount += numtransports;

        if (numtransports > cfg.numtransportswaived) {
            var payingtransports = numtransports -= cfg.numtransportswaived;
            curpay.incentivedollars += cfg.transportpay * payingtransports;
            curpay.paidtransportcount += numtransports;
            shift.info_incentive.dollars += cfg.transportpay * payingtransports;
            shift.info_incentive.payingtransports = payingtransports;
        }

        shift.info_incentive.numtransports = numtransports;
        shift.info_incentive.numcalls = numcalls;
        shift.info_incentive.per_payperiod_lock = per_payperiod;        

        shift.allocatedfor = {
            'system': 'standard incentive'
        };

        //if (curpay.name == 'kevin') {
        __log(10, 'name:{0} id:{1} beginpay:{2} endpay:{3} paydiff:{4} hr12shifts:{5} hours:{6} numcalls:{7} numtransports:{8} start:{9} end:{10}<br/>'.format
        (
            curpay.name, curpay.pid, dbg, curpay.incentivedollars, curpay.incentivedollars - dbg, hr12shifts, hours,
            numcalls, numtransports, shift.start, shift.end
        ));
        //}
    }

    master['shifts'] = shifts;

    cb(master);
}

function plugin_attributes_fetch(key, ids, cb) {
    for (var x = 0; x < ids.length; ++x) {
        ids[x] = String(ids[x]);
    }
    $.get('v1api.py?key={0}&op=get_personnel_attributes&ids={1}'.format
        (key, ids.join(',')), function (data) {
        var mapping = $.parseJSON(data)['result'];
        cb(mapping);
    });                
}


function plugin_pay_bootstrap(
    key, 
    from_year, from_month, from_day, from_hour, 
    to_year, to_month, to_day, to_hour,
    group, config, cb) 
{
    // Go back a month to help grab whole pay period incase we start in the middle of one. This
    // may produce a negative number, but the code below will correct/normalize it.
    --from_month;
    ++to_month;

    // Correct dates so that SQL can handle them correctly. The javascript Date object can handle
    // negative values and values exceeding the set months in a year or days in a month properly,
    // but our SQL backend may not (and does not currently).

    __log(10, 'RNG-RAW-INPUT ' + to_year + '-' + to_month + '-' + to_day + '<br/>');

    var tmp = new Date(from_year, from_month - 1, from_day, from_hour);
    from_year = tmp.getFullYear();
    from_month = tmp.getMonth() + 1;
    from_day = tmp.getDate();
    from_hour = tmp.getHours();
    var tmp = new Date(to_year, to_month - 1, to_day, to_hour);
    to_year = tmp.getFullYear();
    to_month = tmp.getMonth() + 1;
    to_day = tmp.getDate();
    to_hour = tmp.getHours();

    plugin_schedule_fetchmonth(key, from_year, from_month, from_day, to_year, to_month, to_day, group, 
        function (shifts) {
            //alert('got month');
            plugin_calls_fetch(key, from_year, from_month, from_day, to_year, to_month, to_day,
                function(calls) {
                    //alert('got calls ' + calls.length + ' with shift count of ' + shifts.length);
                    shifts = plugin_schedule_enumpersonnelids(key, shifts, 
                        function (shifts) {
                            //alert('enumed ids');
                            var tmp = {}
                            for (var x = 0; x < shifts.length; ++x) {
                                if (shifts[x].pid == null) {
                                    continue;
                                }
                                if (!(shifts[x].pid in tmp)) {
                                    tmp[shifts[x].pid] = true;
                                }
                            }
                            var pids = [];
                            for (var pid in tmp) {
                                pids.push(pid);
                            }

                            plugin_attributes_fetch(key, pids, function(pidattrib) {
                                //alert('got attributes for PIDs');
                                shifts = plugin_schedule_combineadjshifts(key, shifts);
                                plugin_pay_calculator(
                                    pidattrib, calls, shifts, key, 
                                    {
                                        year: from_year,
                                        month: from_month + 1,
                                        day: from_day,
                                        hour: from_hour,
                                    },
                                    {
                                        year: to_year,
                                        month: to_month - 1,
                                        day: to_day,
                                        hour: to_hour,
                                    },
                                    config, cb
                                );
                            });
                    });
            });
        }
    );
}

function plugin_schedule_init() {

}

function plugin_schedule_combineadjshifts(key, shifts) {
    var combine = false;
    for (var ndx = 1; ndx < shifts.length; ++ndx) {
        if (shifts[ndx].pid != null && shifts[ndx-1].pid != null) {
            if (shifts[ndx].pid == shifts[ndx-1].pid) {
                combine = true;
            } else {
                combine = false;
            }
        } else {
            if (shifts[ndx].name == shifts[ndx-1].name) {
                combine = true;
            } else {
                combine = false;
            }
        }
        if (combine) {
            // Make sure they stop and start at the same place.
            if (shifts[ndx-1].end == shifts[ndx].start) {
                // Combine the shifts.
                shifts[ndx].start = shifts[ndx-1].start;
                // Remove one of the shifts and compensate for
                // the increment of `ndx` on iteration.
                shifts = shifts.splice(ndx - 1, 1);
                --ndx;
            } else {
                // The shifts were not adjacent in time. There
                // was likely some blank time between them if
                // even only a few fractions of a second.
            }
        }
    }
    return shifts;
}

function plugin_schedule_enumpersonnelids(key, shifts, cb) {
    // Build a list of all names so that we can convert them into
    // into personnel IDs. This will make matching names much more
    // consistent.
    var names = [];
    var crap = {};
    for (var ndx = 0; ndx < shifts.length; ++ndx) {
        if (!(shifts[ndx].name in crap)) {
            // Only add the name once to decrease server load and
            // increase client load, since I am sure that the client
            // can better handle the load overall.
            names.push(shifts[ndx].name);
            // Yeah.. could not get the IN to work for an array and
            // jQuery complained $.indexOf did not exist, and I read
            // that some browers may not support array.indexOf.
            crap[shifts[ndx].name] = true;
        }
    }

    $.get('v1api.py?key={0}&op=get_personnel_ids&names={1}'.format
        (key, names.join(',')), function (data) {
        var nametoid = plugin_parseResponse(data)['result']['mapping'];
        for (var ndx = 0; ndx < shifts.length; ++ndx) {
            if (shifts[ndx].name in nametoid) {
                shifts[ndx].pid = nametoid[shifts[ndx].name];
            } else {
                shifts[ndx].pid = null;
            }
        }
        cb(shifts);
    });
}

function plugin_parseResponse(data) {
    var response = $.parseJSON(data);
    return response;
}

function plugin_calls_fetch(key, from_year, from_month, from_day, to_year, to_month, to_day, cb) {
    $.get('v1api.py?key={0}&from_year={1}&from_month={2}&from_day={3}&to_year={4}&to_month={5}&to_day={6}&op=readcalls'.format(
        key, from_year, from_month, from_day, to_year, to_month, to_day), function (data) {
        var data = $.parseJSON(data);
        cb(data['result']);
    });
}

function render_calender(year, month, group) {
    $.get('v1api.py?key={0}&grp={1}&year={2}&month={3}&op=readmonth'.format(
        i_key.value, group, year, month 
    ), function (data) {
        var data = $.parseJSON(data);
        var result = data['result'];

        for (var i = 0; i < result.length; ++i) {
            var day = result[i][0];
            var txt = result[i][1];
        }
    });
}

/*
    This will fetch the entire month specified for the group. The data
    for each day of the month will be processed for schedule records
    which will produce a single array containing each record.

    A record is a single line that looks like this:
    <name> <name> (<name>) <start_time>-<end_time>

    The name parts are concencated together, and the start and end
    times are interpreted using 12-hour or 24-hour time formats.

    The callback function takes the following arguments:
        (key, year, month, group data)

    The `data` argument contains an array and each entry in the array is:
        [day_number, name, [start_time, end_time]]

    The start and end time are represented as whole numbers for the
    hours and as fractional parts for the minutes. Therefore the
    following is true:
        1815 == 6:15PM == 18.25
        1345 == 1:45PM == 13.75
        0200 == 2:00AM == 2.0
*/
function plugin_schedule_fetchmonth(key, from_year, from_month, from_day, to_year, to_month, to_day, group, cb) {
    $.get('v1api.py?key={0}&grp={1}&from_year={2}&from_month={3}&from_day={4}&to_year={5}&to_month={6}&to_day={7}&op=readcalendar'.format(
        key, group, from_year, from_month, from_day, to_year, to_month, to_day
    ), function (data) {
        var data = $.parseJSON(data);
        var result = data['result'];
        var out = [];

        for (var i = 0; i < result.length; ++i) {
            // Read the record fields.
            var year = result[i][0];
            var month = result[i][1];
            var day = result[i][2];
            var txt = result[i][3];

            var lines = txt.split('\x06');
            for (var ndx in lines) {
                var line = lines[ndx].trim();
                if (line.length < 1) {
                    continue;
                }
                while (line.indexOf('  ') > -1) {
                    line = line.replace('  ', ' ');
                }
                while (line.indexOf('__') > -1) {
                    line = line.replace('__', '_');
                }
                var parts = line.split(" ");
                // substring(0 indexed inclusive, exclusive)
                // $.isNumeric(..)

                function parsetimerange(range) {
                    function parsetimepair(pair) {
                        function _parsetimepair(pair) {
                            if (pair.length < 3) {
                                var hr = parseInt(pair);
                                return [hr, hr, 0];
                            }
                            var min = parseInt(pair.substring(pair.length - 2));
                            var hr = parseInt(pair.substring(0, pair.length - 2));
                            return [hr + (min / 60.0), hr, min];
                        }
                        if (!$.isNumeric(pair.substring(pair.length - 1))) {
                            //alert('has p or a for "' + pair.substring(0, pair.length - 1) + '" as: ' + pair);
                            var t = _parsetimepair(pair.substring(0, pair.length - 1));
                            var sh12 = pair.substring(pair.length - 1);
                            sh12 = sh12.toLowerCase();
                            if (sh12 == 'p') {
                                t[0] += 12;
                                t[1] += 12;
                            }
                            return t;
                        } else {
                            return _parsetimepair(pair);
                        }

                    }

                    var pair = range.split('-');
                    return [parsetimepair(pair[0]), parsetimepair(pair[1])];
                }

                var rng = null;
                var x = 0;
                for (; x < parts.length; ++x) {
                    if ($.isNumeric(parts[x].substring(0, 1))) {
                        // This should be the time range.
                        rng = parsetimerange(parts[x]);
                        if (isNaN(rng[0][0])) {
                            warn('Report abnormal condition.');
                        }
                        break;
                    }
                }

                //alert(line + ':' + rng[0] + ':' + rng[1]);
                if (rng != null) {
                    var name = parts.slice(0, x).join(' ').trim('.');
                    var shift = new Shift();
                    if (name == '') {
                        name = '<nobody>';
                    }
                    shift.name = name.toLowerCase().replace('.', '');
                    shift.year = year;
                    shift.month = month;
                    shift.day = day;
                    shift.start = rng[0];
                    shift.end = rng[1];
                    out.push(shift);
                }
            }
        }

        // This performs two functions:
        //      (1) it converts the start and end time into a complete date and time
        //      (2) it handles cases wheres shifts reach into the next day
        var triggered = false;
        var triggered_mark = 0;
        var sday_adv_signal = false;
        var eday = null;
        var sday = null;


        var lend = null;
        var mock_shift = false;

        for (var i = 0; i < out.length; ++i) {
            mock_shift = false;

            if (lend != null && lend != out[i].start[0]) {
                mock_shift = true;
                lend = out[i].start[0];
                --i;
            } else {
                lend = out[i].end[0];
            }


            if (triggered_mark != out[i].day) {
                // The advancement is reset if it does not match the day.
                eday = out[i].day;
                sday = out[i].day;
                sday_adv_signal = false;
            }

            if (sday_adv_signal) {
                sday = out[i].day + 1;
            }

            // Spans into the next day.
            if (out[i].end[0] < out[i].start[0]) {
                // Lock the advancement to this day.
                triggered_mark = out[i].day;
                // Signal for the start day to be advanced next iteration.
                sday_adv_signal = true;
                // Advance end day.
                eday = out[i].day + 1;
            }

            // Starts on the next day.
            if (out[i].start[0] == 0.0) {
                triggered_mark = out[i].day;
                sday_adv_signal = true;
                // Advance start and end day.
                sday = out[i].day + 1;
                eday = out[i].day + 1;
            }

            // Ends on the next day.
            if (out[i].end[0] == 0.0) {
                triggered_mark = out[i].day;
                // Signal for the start day to be advanced next iteration.
                sday_adv_signal = true;
                // Advance end day.
                eday = out[i].day + 1;
            }

            // It is a 24 hour shift (max). Keep `sday` since it
            // may have been advanced and increment `eday` based
            // on `sday`.
            if (out[i].end[0] == out[i].start[0]) {
                eday = sday + 1;
            }

            // A mock shift is artificially simulated to fill in the gap
            // between two shifts where one exists and was not specified.
            //
            // This block will not execute for a mock shift. Also, the index
            // is actually behind by one. So if we did execute this we would
            // create a second copy of the last shift (not this presumed shift).
            if (!mock_shift) {
                // Note:
                //  If the eday or sday exceeds the actual days for a month the 
                //  Date object will roll over into the next month giving the
                //  correct date.
                var tmp = [out[i].start[0], out[i].end[0]];
                out[i].start = new Date(out[i].year, out[i].month - 1, sday, out[i].start[1], out[i].start[2]);
                out[i].end = new Date(out[i].year, out[i].month - 1, eday, out[i].end[1], out[i].end[2]);
                //if (out[i].name == 'heather') {
                //    __log(10, '@@@{0} {1} {2} {3} {4} ... {5} {6}<br/>'.format(out[i].year, out[i].month, out[i].day, out[i].start, out[i].end, tmp[0], tmp[1]));
                //}
                //__log(10, 'i:{0} name:{1} year:{2} month:{3} day:{4} start:{5} end:{6}<br/>'.format(
                //    i, out[i].name, out[i].year, out[i].month, out[i].day, out[i].start, out[i].end
                //));                            
            }
        }

        __log(10, 'compiled {0} records from the database'.format(out.length));

        // Set the clone method for all shift objects.
        for (var i = 0; i < out.length; ++i) {
            out[i].clone = clonemethod;
            out[i].splitby = splitbymethod;
            out[i].splitbymulti = splitbymultimethod;
            out[i].pid = null;
            out[i].allocatedfor = null;
            out[i].excludeafter =  excludeaftermethod;
            out[i].offsetintoshift = offsetintoshiftmethod;
        }

        cb(out);
    });
}

function Shift() {
    this.start = null;
    this.end = null;
    this.events = [];
    return {};
}

Shift.prototype.clone = function () {
    // Do a rough shallow copy.
    var no = {};
    for (var k in this) {
        no[k] = this[k];
    }
    // Handle the few things that we do know need to be
    // handled in a special way in order to truely duplicate
    // them.
    var nevents = [];
    for (var x = 0; x < this.events.length; ++x) {
        nevents.push(this.events[x]);
    }
    no.events = nevents;
    no.start = this.start.clone();
    no.end = this.end.clone();
    return no;
}

Shift.prototype.splitby = function(by) {
    if (by > this.start && by < this.end) {
        var nshift = this.clone();
        var oshift = this.clone();
        nshift.start = by;
        oshift.end = by;
        nshift.dropEventsNotCovered();
        oshift.dropEventsNotCovered();
        return [oshift, nshift];
    }
    return null;
}

Shift.prototype.splitbymulti = function(by) {
    var work = [this.clone()];
    for (var i = 0; i < by.length; ++i) {
        for (var x = 0; x < work.length; ++x) {
            var result = work[x].splitby(by[i]);
            if (result != null) {
                work.splice(x, 1, result[0], result[1]);
                ++x;
            }
        }
    }
    if (work.length == 1) {
        // Do not return original to signal
        // that nothing happened to the original.
        return [];
    }
    // Return all pieces.
    return work;
}

Shift.prototype.adjustStart = function (hours) {
    this.adjustDate(this.start, hours);
    this.dropEventsNotCovered();
}

Shift.prototype.adjustEnd = function (hours) {
    this.adjustDate(this.end, hours);
    this.dropEventsNotCovered();
}

Shift.prototype.adjustDate = function (date, hours) {
    date.setTime(date.getTime() + hours * 1000.0 * 60.0 * 60.0);
}

Shift.prototype.dropEventsNotCovered = function () {
    for (var z = 0; z < this.events.length; ++z) {
        if (this.events[z].date < this.start || this.events[z].date > this.end) {
            this.events.splice(z, 1);
            --z;
        }
    }
}

Shift.prototype.excludeafter = function (by, reverse) {
    if (reverse) {
        if (this.end <= by) {
            return null;
        }
    } else {
        if (this.start > by) {
            return null;
        }
    }

    var result = this.splitby(by);
    if (result != null) {
        if (reverse) {
            return result[0];
        }
        return result[1];
    }
    return this;
};

Shift.prototype.offsetintoshift = function (hours) {
    var totalhoursinshift = (this.end - this.start) / 1000.0 / 60.0 / 60.0;
    if (hours > totalhoursinshift) {
        return [0, hours - totalhoursinshift];
    }
    if (hours == totalhoursinshift) {
        return [1, this.end.clone()];
    }
    return [2, this.start.clone().adjustdatebyfphours(hours)];
}

/*
    The global  core object.
*/
var xemo = {};
xemo.core = {};
xemo.plugins = {};

if (typeof(module) != 'undefined') {
    module.exports = xemo.core;
}

String.prototype.format = function () {
    var args = arguments;
    return this.replace(/\{\{|\}\}|\{(\d+)\}/g, function (m, n) {
        if (m == "{{") { return "{"; }
        if (m == "}}") { return "}"; }
        return args[n];
    });
};

Date.prototype.shortString = function () {
    var hrs = new String(this.getHours());
    var min = new String(this.getMinutes());
    if (hrs.length < 2) {
        hrs = '0' + hrs;
    }
    if (min.length < 2) {
        min = '0' + min;
    }
    return '{1}/{2}/{0} {3}:{4}'.format(
        this.getFullYear(), this.getMonth() + 1, this.getDate(),
        hrs, min
    );
}

Date.prototype.isValid = function (from) {
    return isNaN(this.getTime()) == false;
}

Date.prototype.dayIndexFrom = function (from) {
    return Math.floor(this.subtractTimeConsideringTimezone(from) / 1000.0 / 60.0 / 60.0 / 24);
}

Date.prototype.adjustdatebyfphours = function (h) {
    this.setTime(this.getTime() + (h * 60.0 * 60.0 * 1000.0));
    if (isNaN(this.getTime())) {
        throw new Error('Adjustment of date by floating-point hours produced invalid date.');
    }
    return this;
}

/*
    When dealing with absolute time this function would give you incorrect results, however
    some things deal with local time only and in those cases we have to deal with the problem
    of a time-zone offset change. Some date can have a change in offset due to the actual date
    such as day-light savings time.
*/
Date.prototype.subtractTimeConsideringTimezone = function (a) {
    var diff = (this.getTime() - a.getTime());

    var tzdiff = a.getTimezoneOffset() - this.getTimezoneOffset();

    return diff + tzdiff * 60 * 1000.0;
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

function nu(v) {
    if (v == undefined) {
        xemo.core.waitError('Important parameter was undefined.');
        alert('important parameter was undefined');
    }
    return v;
}


function system_hourly_lunchgrab(params) {
    var pps = params.cur_pp_start;
    var ppe = params.cur_pp_end;    
    var allocationid = nu(params.allocationid);
    var note = params.note;    
    var shifts = params.shifts;
    var cap = params.cap;
    var pid = params.pid;
    // The allocation to try to tag one hour onto.
    var aidtag = params.aidtag;


    var gothours = enumeratehoursbyid(shifts, pps, ppe, allocationid);

    var need = cap - gothours;
    var allocated = [];
    var pass = 0;

    var ordered = [
        [], [], [], [], [], [], []
    ];

    for (var x = 0; x < shifts.length; ++x) {
        var shift = shifts[x];

        if (shift.start < pps || shift.start >= ppe) {
            continue;
        }

        if (shift.pid != pid) {
            continue;
        }

        var dayndx = shift.start.dayIndexFrom(pps);

        if (shift.allocatedfor != null && shift.allocatedfor.id == aidtag) {
            var dur = shift.getTimeDuration();
            for (var y = 0; y < ordered[dayndx].length; ++y) {
                if (dur > ordered[dayndx][y][0]) {
                    ordered[dayndx].splice(y, 0, [dur, shift, x]);
                    dur = null;
                    break;
                }
            }
            if (dur != null) {
                ordered[dayndx].push([dur, shift, x]);
            }
        }
    }

    var toinsert = [];

    while (need > 0) {
        var lastneed = need;
        for (var d = 0; d < ordered.length; ++d) {
            var dayneed = 1;
            for (var x = 0; x < ordered[d].length; ++x) {
                var shift = ordered[d][x][1];
                var shiftndx = ordered[d][x][2];

                if (dayneed <= 0) {
                    break;
                }

                if (need <= 0) {
                    break;
                }

                var hours = shift.getTimeDuration() / 1000 / 60 / 60;
                var nstart = shift.start.clone();
                var h = Math.floor(hours / 2);
                var gothere = hours - h;
                if (gothere > 1) {
                    gothere = 1;
                }
                if (gothere > need) {
                    gothere = need;
                }
                nstart.adjustdatebyfphours(h);
                var nend = nstart.clone().adjustdatebyfphours(gothere);

                var result = shift.splitbymulti([nstart, nend]);
                var picked;
                if (result.length > 0) {
                    need -= gothere;             
                    dayneed -= gothere;
                    switch (result.length) {
                        case 3: picked = result[1]; break;
                        case 2: picked = result[1]; break;
                        case 1: picked = result[0]; break;
                        case 0: throw Error('lunch carve.. 0 items in result!'); break;
                    }
                    picked.allocatedfor = { id: allocationid, note: note };
                    allocated.push({
                        'start':          picked.start.clone(),
                        'end':            picked.end.clone(),
                        '__shift':        picked,
                    });

                    toinsert.push([shiftndx, result]);
                } else {
                    picked = shift;
                    need -= hours;
                    dayneed -= hours;
                    shift.allocatedfor = { id: allocationid, note: note };
                }

                ordered[d].splice(x, 1);
                if (result.length > 0) {
                    for (var y = 0; y < result.length; ++y) {
                        if (result[y] != picked) {
                            ordered[d].push(result[y]);
                        }
                    }
                }
                --x;
            }
        }
        if (need == lastneed) {
            break;
        }        
    }

    //

    toinsert.sort(function (a, b) {
        // Largest to smallest.
        if (a[0] < b[0]) {
            return 1;
        }
        if (a[0] > b[0]) {
            return -1;
        }
        return 0;
    });

    for (var x = 0; x < toinsert.length; ++x) {
        shifts.splice(toinsert[x][0], 1);
        for (var y = toinsert[x][1].length - 1; y > -1; --y) {
            shifts.splice(toinsert[x][0], 0, toinsert[x][1][y]);
        }
    }

    return {
        'total':      gothours,
        'shifts':     allocated,
    };
}

xemo.core.split_shifts_by_hour_and_min = function (shifts, pid, by_hour, by_minutes, range_start, range_end) {
    for (var i = 0; i < shifts.length; ++i) {
        if (range_start != undefined && shifts[i].start < range_start) {
            continue;
        }

        if (range_end != undefined && shifts[i].start >= range_end) {
            continue;
        }

        if (shifts[i].allocatedfor != null) {
            continue;
        }

        if (shifts[i].pid != pid) {
            continue;
        }

        var daycnt = Math.ceil(
            shifts[i].end.subtractTimeConsideringTimezone(shifts[i].start) /
            1000 / 60 / 60 / 24
        );

        var ready = [];
        var initial = shifts[i].start.clone();
        var working = shifts[i];

        /*
            Try to break the shift AND handle the shift
            spanning multiple days.
        */
        for (var cday = 0; cday < daycnt; ++cday) {
            var by = initial.clone();
            by.setDate(by.getDate() + cday);
            by.setHours(by_hour);
            by.setMinutes(by_minutes);
            var result = working.splitby(by);
            if (result != null) {
                ready.push(result[0]);
                working = result[1];
            }
        }

        /*
            If the shift was broken at least once
            then we need to insert the new shifts.
        */
        if (ready.length > 0) {
            ready.push(working);
            ready.splice(0, 0, 1);
            ready.splice(0, 0, i);
            shifts.splice.apply(shifts, ready);
            /*
                If we insert one new shift we jump ahead one.
                If we insert two new shifts we jump ahead two.
                ...
            */
            i += ready.length - 3;
        }
    }
};


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

    var allocationid = nu(params.allocationid);
    var magnetichour = nu(params.magnetichour);
    var avoidspecial = nu(params.avoidspecial);
    var stdhoursbegin = nu(params.stdhoursbegin);
    var stdhoursend = nu(params.stdhoursend);
    var stddaysbegin = nu(params.stddaysbegin);
    var stddaysend = nu(params.stddaysend);
    var startfiddle = params.startfiddle || 8;
    var note = params.note;
    var adaptive = nu(params.adaptive);
    // A function used to evaluate if the day is valid to be used.
    var stddayfunc = params.stddayfunc;

    xemo.core.log(10, 'HOURS-ALLOCATOR adaptive:{4} id:{2} note:{3} for {0} to {1}<br/>'.format(cur_pp_start, cur_pp_end, allocationid, note, adaptive));

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
            xemo.core.log(10, 'dayndx:' + dayndx + ' start:' + shifts[i].start + ' pp_start:' + cur_pp_start + '<br/>');
            // TODO... use subtractTimeConsideringTimezone???
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
                    xemo.core.log(10, 'only ' + (tmp + totalhours) + ' in pay period.. no need for premutation algo.. took all remaining hours and shifts..<br/>');
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
        var fiddle = startfiddle;
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

        var bestmap = null;
        var bestcount = -1;
        var besthours = -1;

        /*
        xemo.core.log(10, 'DAYSHIFTS DUMP');
        for (var ndx = 0; ndx < dayshifts.length; ++ndx) {
            for (var y = 0; y < dayshifts[ndx].length; ++y) {
                var shift = dayshifts[ndx][y];
                xemo.core.log(10, '   dayshifts[{0}][{1}] start:{2} end:{3}'.format(
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
                var hourstakenforday = 0;
                // Try to take 8 hours minimum and maximum.
                for (var y = 0; y < dayshifts[ndx].length; ++y) {
                    var shift = dayshifts[ndx][y];
                    var totalshifthours = (shift.__end - shift.start) / 1000.0 / 3600.0;
                    var need = cap - (curhoursgot + totalhours);

                    // The fiddle will cap the maximum hours to grab.
                    if (need > (fiddle - hourstakenforday)) {
                        need = (fiddle - hourstakenforday);
                    }

                    if (need <= 0) {
                        break;
                    }                    

                    var s_start;
                    var s_end;
                    if (totalshifthours > need) {
                        hourstakenforday += need;
                        curhoursgot += need;
                        // What would we have made in incentive? Find all calls
                        // inside the remaining shift.
                        s_end = shift.start.clone();
                        s_end.adjustdatebyfphours(need);
                        s_start = shift.start;

                        if (!pretend) {
                            var nshift = shift.clone();
                            
                            // The magnetic hour trys to move the time as close
                            // as possible to the specified hour. I wrote the
                            // code this way to reduce duplicate code and to
                            // keep from changing existing code as much as 
                            // possible.
                            var magused;

                            if (!magnetichour || shift.start.getHours() >= magnetichour) {
                                // The original code.
                                nshift.start.adjustdatebyfphours(need);
                                shift.end = nshift.start.clone();
                                toinsert[shift.__ndx + 1] = nshift;
                                magused = false;
                            } else {
                                // The actual magnetic hour code.
                                nshift.start = nshift.end.clone();
                                nshift.adjustStart(-need);
                                shift.end = nshift.start.clone();
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

                            shift.dropEventsNotCovered();
                            nshift.dropEventsNotCovered();

                            if (!shift.isValid() || !nshift.isValid()) {
                                alert('ggg');
                            }

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
                        hourstakenforday += totalshifthours;
                        curhoursgot += totalshifthours;
                        // We are going to just remove the entire shift.
                        if (!pretend) {
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

                    for (var z = 0; z < shift.events.length; ++z) {
                        if (shift.events[z].isEMSTransport()) {
                            ++transportcount;
                        }
                    }
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
                    return;
                }
            }
        });

        // Actually do the premutate map.
        xemo.core.log(10, 'working best map with transportcount of ' + bestcount + ' for hours of ' + besthours + ' added to ' + totalhours + ' hours<br/>');
        xemo.core.log(10, 'using-best-map:' + bestmap.join(','));
        var result = work_premutate_map(bestmap, false);
        
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

            // We split a 6AM to 2PM so if it starts at 6 and on a weekday then we can use it.
            var shift_start_hour = shifts[i].start.getHours();

            var stddayfuncpassed;

            if (stddayfunc == undefined || stddayfunc(shifts[i].start)) {
                stddayfuncpassed = true;
            } else {
                stddayfuncpassed = false;
            }

            if (
                shift_start_hour >= stdhoursbegin && shift_start_hour < stdhoursend && shifts[i].start.getDay() >= stddaysbegin && 
                shifts[i].start.getDay() <= stddaysend &&
                stddayfuncpassed
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

                if (totalshifthours > need) {
                    totalhours += need;

                    var nshift = shifts[i].clone();
                    nshift.adjustStart(need);
                    shifts[i].end = nshift.start.clone();

                    nshift.isValid();
                    shifts[i].isValid();

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
                } else {
                    totalhours += totalshifthours;
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

    xemo.core.log(10, 'hourly_withcap; allocationid:{0} gothours:{1} start:{2} end:{3}'.format(
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
    xemo.core.log(10, 'A.1: total hours was {0} of {1}<br/>'.format(totalhours, cap));
    if (totalhours < cap && allownonstdhours) {
        totalhours = __b(a_allocated, totalhours, cur_pp_start, tmp);
        xemo.core.log(10, 'B.1: total hours was {0} of {1}<br/>'.format(totalhours, cap));
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
    xemo.core.log(10, 'A.2 total hours of was {0} of {1}<br/>'.format(totalhours, cap));
    if (totalhours < cap && allownonstdhours) {
        totalhours = __b(b_allocated, totalhours, tmp, cur_pp_end);
        xemo.core.log(10, 'B.2: total hours was {0} of {1}<br/>'.format(totalhours, cap));
    }

    ret['b'] = {
        'total':     totalhours,
        'shifts':    a_allocated,
        'start':     tmp,
        'end':       cur_pp_end.clone(),
    };

    xemo.core.log(10, 'doing next iteration<br/>');
    return ret;
    */
}

function warn(msg) {
    alert('A warning was issued. Please tell Kevin:\n' + msg);
}

xemo.core.sopv2 = function (data, callback, noerror) {
    xemo.core.sop(data, function (data) {
        callback(data.result);
    }, noerror);
}

xemo.core.sop = function (data, callback, noerror) {
    data = xemo.core.objtojson(data);
    xemo.core.log(10, 'SOP-REQUEST: ' + data);
    $.post('interface', data, function (data) {
        xemo.core.log(10, 'SOP-RESPONSE: ' + data);
        var response = $.parseJSON(data);
        if (response.code == 'error' && !noerror) {
            xemo.core.waitError(response.error);
            return;
        }
        callback(response);
    }).fail(function (a) {
        xemo.core.waitError('Please check your internet connection.');
    });
}

/*
    This will return the pay period that the date resides inside.

    @param d:        date object
    @param half:     0 - 14 day pay period as [start, end]
                     1 - 7 day pay period as [start, end]
                     2 - 14 day and 7 day pay period as [[start14, end14], [start7, end7]]

    TODO: clean up the code.. it has become messy from minimal bug refactoring..
*/
xemo.core.getpayperiodidbydate = function (d, half, refstart) {
    if (refstart == undefined || half == undefined) {
        throw Error('xemo.core.getpayperiodidbydate MUST have a half and refstart specified');
        //var pp_start = new Date(2015, 7 - 1, 9, 6);
    }
    var pp_start = refstart;
    var pp_end = pp_start.clone();
    pp_end.setDate(pp_end.getDate() + 14);

    // TODO: clean this up
    //var pp_end = new Date(2015, 7 - 1, 23, 6);
    var __pp_start = pp_start.clone();
    var __pp_end = pp_end.clone();
    var tmp = new Date(2015, 4, 30, 14);
    var pcount = 0;
    half = half || 0;
    if (d < __pp_start) {
        for (; d < __pp_start; __pp_start.setDate(__pp_start.getDate() - 14), __pp_end.setDate(__pp_end.getDate() - 14)) {
            --pcount;
        }
    } else {
        // Only increment if the day is greater than the end of the currently specified pay period.
        for (; d >= __pp_end; __pp_start.setDate(__pp_start.getDate() + 14), __pp_end.setDate(__pp_end.getDate() + 14)) {
            ++pcount;
        }
    }
    if (half > 0) {
        var hs = __pp_start.clone();
        var he = __pp_end.clone();
        var hoffset;
        // In this case we only do half a bi-weekly pay period which is only 7 days.
        if ((d.subtractTimeConsideringTimezone(hs) / 1000.0 / 60.0 / 60.0 / 24.0) >= 7.0) {
            hs.setDate(hs.getDate() + 7);
            hoffset = 1;
        } else {
            he.setDate(he.getDate() - 7);
            hoffset = 0;
        }
        if (half > 1) {
            // The caller wants both 14 day periods and 7 day periods.
            return [[__pp_start, __pp_end, pcount], [hs, he, pcount * 2 + hoffset]];
        }
        // The caller only wants 7 day periods.
        return [hs, he, pcount * 2 + hoffset];
    }
    // The caller only wants 14 day periods.
    return [__pp_start, __pp_end, pcount];
}

xemo.core.modulus = function (x, m) {
    if (x < 0) {
        return (m - (Math.abs(x) % m)) % m;
    }
    return x % m
}

xemo.core.getShiftIndex = function (refdate, tardate, shiftcount) {
    var diff = tardate.subtractTimeConsideringTimezone(refdate);
    var shiftndx = diff / 1000 / 60 / 60 / 24;

    shiftndx = Math.floor(shiftndx);

    shiftcount = shiftcount || 3;

    return xemo.core.modulus(shiftndx, shiftcount);
};

xemo.core.paysys = {
    'DIRECTOR': function (params) {
        var shifts = params.shifts;
        var ppstart = params.ppstart;
        var ppend = params.ppend;
        var calls = params.calls;
        var pid = params.pid;
        var specs = params.specs;

        var payperiodref = params.payperiodref;

        var ppinfo = xemo.core.getpayperiodidbydate(ppstart, 2, payperiodref);
        var pp7index = ppinfo[1][2];
        var pp14index = ppinfo[0][2];

        var shift_letter_ref = new Date('8/6/2015 08:00');

        /*
            We need to make sure the shifts are split at 8AM each day, because the
            ABC shift mechanism will only check the beginning time of each shift to
            determine which letter shift it is on. This function will handle doing
            that splitting only for:

                * unallocated shifts
                * shifts with the specified PID
                * shift start time between `ppstart` and `ppend`

            At this point all shifts for this personnel *should* have already been
            split across pay period boundaries. The pay period boundaries are defined
            by `ppstart` and `ppend`. We could do it again, but it would be wasteful
            of resources, however it should be noted.

            _This function splits by hours:minute for each day instead of using
            absolute times for splitting it uses local day time._
        */
        xemo.core.split_shifts_by_hour_and_min(shifts, pid, 8, 0, ppstart, ppend);

        /* Determine how many hours are in this week for a specific shift. */
        var hourcap = 0;
        for (var d = 0; d < 7; ++d) {
            var nd = ppinfo[1][0].clone();
            nd.setDate(nd.getDate() + d);
            var shift_letter = xemo.core.getShiftIndex(shift_letter_ref, nd);
            if (shift_letter == 0) {
                hourcap += 24;
            }
        }

        // 6th @ 0700 with LETTER = 0 IS WRONG


        var param_std = {
            'shifts':         shifts,
            'cur_pp_start':   ppstart,
            'cur_pp_end':     ppend,
            'cap':            hourcap,
            'pid':            pid,
            'calls':          calls,
            'magnetichour':   false,
            'stdhoursbegin':  0,
            'stdhoursend':    24,
            'stddaysbegin':   0,
            'stddaysend':     6,
            'stddayfunc':     function (start) {
                var letter = xemo.core.getShiftIndex(shift_letter_ref, start);
                if (letter == 0) {
                    return true;
                }
                
                return false;
            },
            'avoidspecial':     false,
            'adaptive':       false,
            'allocationid':   'DIRECTOR PAY SCHEDULE 1',
            'note':           'STANDARD PAY'
        };

        var param_nonstd = {
            'shifts':         shifts,
            'cur_pp_start':   ppstart,
            'cur_pp_end':     ppend,
            'cap':            hourcap,
            'pid':            pid,
            'calls':          calls,
            'magnetichour':   false,
            'stdhoursbegin':  0,
            'stdhoursend':    24,
            'stddaysbegin':   0,
            'stddaysend':     6,
            'avoidspecial':   false,
            'adaptive':       false,
            'allocationid':   'DIRECTOR PAY SCHEDULE 1',
            'note':           'NON-STANDARD PAY'
        };        

        var param_over = {
            'shifts':         shifts,
            'cur_pp_start':   ppstart,
            'cur_pp_end':     ppend,
            'cap':            1000000,
            'pid':            pid,
            'calls':          calls,
            'magnetichour':   false,
            'stdhoursbegin':  0,
            'stdhoursend':    24,
            'stddaysbegin':   0,
            'stddaysend':     6,
            'avoidspecial':     false,
            'adaptive':       false,
            'allocationid':   'DIRECTOR OVERTIME PAY SCHEDULE 1',
            'note':           'OVERTIME PAY'
        };

        var ret = system_hourly_withcap(param_std);
        var ret = system_hourly_withcap(param_nonstd);
        var ret = system_hourly_withcap(param_over);
    },
    'PART_TIME_MEDIC': function (params) {
        var shifts = params.shifts;
        var ppstart = params.ppstart;
        var ppend = params.ppend;
        var calls = params.calls;
        var pid = params.pid;

        var param_normal = {
            'shifts':         shifts,
            'cur_pp_start':   ppstart,
            'cur_pp_end':     ppend,
            'cap':            40,
            'pid':            pid,
            'calls':          calls,
            'magnetichour':   false,
            'stdhoursbegin':  0,
            'stdhoursend':    24,
            'stddaysbegin':   0,
            'stddaysend':     6,
            'adaptive':       false,
            'avoidspecial':     false,
            'allocationid':   'MEDIC PAY SCHEDULE 1',
            'note':           'STANDARD PAY'                
        };

        var param_over = {
            'shifts':         shifts,
            'cur_pp_start':   ppstart,
            'cur_pp_end':     ppend,
            'cap':            1000000,
            'pid':            pid,
            'calls':          calls,
            'magnetichour':   false,
            'stdhoursbegin':  0,
            'stdhoursend':    24,
            'stddaysbegin':   0,
            'stddaysend':     6,
            'adaptive':       false,
            'avoidspecial':     false,
            'allocationid':   'MEDIC OVERTIME PAY SCHEDULE 1',
            'note':           'OVERTIME PAY' 
        };

        var ret = system_hourly_withcap(param_normal);
        var ret = system_hourly_withcap(param_over);
    },
    'INCENTIVE_DRIVER': function (params) {
        var shifts = params.shifts;
        var ppstart = params.ppstart;
        var ppend = params.ppend;
        var calls = params.calls;
        var pid = params.pid;

        var param_incentive = {
            'shifts':           shifts,
            'cur_pp_Start':     ppstart,
            'cur_pp_end':       ppend,
            'cap':              1000000,
            'pid':              pid,
            'calls':            calls,
            'stdhoursbegin':    0,
            'stdhoursend':      24,
            'stddaysbegin':     0,
            'stddaysend':       6,
            'magnetichour':     false,
            'adaptive':         false,
            'avoidspecial':     false,
            'allocationid':     'STANDARD INCENTIVE',
            'note':             ''
        };

        var result = system_hourly_withcap(param_incentive);
    },
    'DRIVER_8X5': function (params) {
        var shifts = params.shifts;
        var ppstart = params.ppstart;
        var ppend = params.ppend;
        var calls = params.calls;
        var pid = params.pid;

        var hours5x8 = 0;

        var param_hours5x8std = {
            'shifts':         shifts,
            'cur_pp_start':   ppstart,
            'cur_pp_end':     ppend,
            'cap':            40,
            'pid':            pid,
            'calls':          calls,
            'magnetichour':   false,
            'stdhoursbegin':  6,
            'stdhoursend':    14,
            'stddaysbegin':   1,
            'stddaysend':     5,
            'adaptive':       false,
            'avoidspecial':   false,
            'allocationid':   '8x5 PAY',
            'note':           'STANDARD HOURS'
        };

        var param_hours5x8nonstd = {
            'shifts':         shifts,
            'cur_pp_start':   ppstart,
            'cur_pp_end':     ppend,
            'cap':            40,
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

        var param_incentive = {
            'shifts':           shifts,
            'cur_pp_Start':     ppstart,
            'cur_pp_end':       ppend,
            'cap':              1000000,
            'pid':              pid,
            'calls':            calls,
            'stdhoursbegin':    0,
            'stdhoursend':      24,
            'stddaysbegin':     0,
            'stddaysend':       6,
            'magnetichour':     false,
            'adaptive':         false,
            'avoidspecial':     false,
            'allocationid':     'STANDARD INCENTIVE',
            'note':             ''
        };

        // Try to allocate hours between 6A and 2P on weekdays.
        var ret = system_hourly_withcap(param_hours5x8std);
        hours5x8 = ret.total;

        if (hours5x8 < 40) {
            var ret = system_hourly_withcap(param_hours5x8nonstd);
            hours5x8 = ret.total;
        }

        var result = system_hourly_withcap(param_incentive);
    },
    'DRIVER_8X54X6': function (params) {
        var shifts = params.shifts;
        var ppstart = params.ppstart;
        var ppend = params.ppend;
        var calls = params.calls;
        var pid = params.pid;

        var hours5x8 = 0;
        var hours4x6 = 0;

        var param_hours5x8std = {
            'shifts':         shifts,
            'cur_pp_start':   ppstart,
            'cur_pp_end':     ppend,
            'cap':            45,
            'pid':            pid,
            'calls':          calls,
            'magnetichour':   false,
            'stdhoursbegin':  6,
            'stdhoursend':    15,
            'stddaysbegin':   1,
            'stddaysend':     5,
            'adaptive':       false,
            'avoidspecial':   false,
            'allocationid':   '8x5 PAY',
            'note':           'STANDARD HOURS'
        };

        var param_hourslunch = {
            'shifts':         shifts,
            'cur_pp_start':   ppstart,
            'cur_pp_end':     ppend,
            'cap':            -1,    // calculated later
            'pid':            pid,
            'calls':          calls,
            'allocationid':   '8x5 LUNCH',
            'note':           'CARVED OUT',           
            'aidtag':         '8x5 PAY' 
        };

        var param_hours5x8nonstd = {
            'shifts':         shifts,
            'cur_pp_start':   ppstart,
            'cur_pp_end':     ppend,
            'cap':            45,
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
            'cur_pp_start':     ppstart,
            'cur_pp_end':       ppend,
            'cap':              15,
            'pid':              pid,
            'calls':            calls, 
            'magnetichour':     false,
            'stdhoursbegin':    15,
            'stdhoursend':      18,
            'stddaysbegin':     1,
            'stddaysend':       5,
            'adaptive':         false,
            'avoidspecial':     false,
            'allocationid':     '4x6 PAY',
            'note':             'STANDARD HOURS' 
        };

        var param_hours4x6nonstd = {
            'shifts':           shifts,
            'cur_pp_start':     ppstart,
            'cur_pp_end':       ppend,
            'cap':              15,
            'pid':              pid,
            'calls':            calls, 
            'stdhoursbegin':    0,
            'stdhoursend':      24,
            'stddaysbegin':     0,
            'stddaysend':       6,
            'magnetichour':     6,
            'adaptive':         true,
            'avoidspecial':     true,   // avoid transports (special)
            'allocationid':     '4x6 PAY',
            'note':             'NON-STANDARD HOURS' 
        };

        var param_incentive = {
            'shifts':           shifts,
            'cur_pp_Start':     ppstart,
            'cur_pp_end':       ppend,
            'cap':              1000000,
            'pid':              pid,
            'calls':            calls,
            'stdhoursbegin':    0,
            'stdhoursend':      24,
            'stddaysbegin':     0,
            'stddaysend':       6,
            'magnetichour':     false,
            'adaptive':         false,
            'avoidspecial':     false,
            'allocationid':     'STANDARD INCENTIVE',
            'note':             ''
        };

        // Try to allocate hours between 6A and 2P on weekdays.
        var ret = system_hourly_withcap(param_hours5x8std);
        hours5x8 = ret.total;

        // Try to allocate hours between 3P and 6P on weekdays.
        var hold4x6 = system_hourly_withcap(param_hours4x6std);
        hours4x6 = hold4x6.total;

        if (hours5x8 < 45) {
            // If we did not have enough hours, then try to allocate
            // the needed hours during any time on any day. Also, 
            // use the adaptive algorithm to try to keep certain
            // incentive generating activities on incentive time.
            var ret = system_hourly_withcap(param_hours5x8nonstd);
            hours5x8 = ret.total;
        }

        // If we still do not have enough hours we need to drop
        // our 4x6 PAY shifts and try to allocate again.
        if (hours5x8 < 45) {
            // Free any lunch hours.. 40 hours is more important.
            for (var x = 0; x < hold4x6.shifts.length; ++x) {
                // This will make the shift free for allocation. We use
                // the temporary __shift member. This is prefixed because
                // it is internal usage only.
                hold4x6.shifts[x].__shift.allocatedfor = null;
            }
            var ret = system_hourly_withcap(param_hours5x8nonstd);
            hours5x8 = ret.total;

            // Reallocate standard 4x6 if possible.. after lunch..
            hold4x6 = system_hourly_withcap(param_hours4x6std);
            hours4x6 = hold4x6.total;
        }

        var lunchcap = hours5x8 - 40;
        if (lunchcap > 0) {
            param_hourslunch.cap = lunchcap;
            system_hourly_lunchgrab(param_hourslunch);
        }

        // Try to allocate non-standard 4x6..
        //var result = system_hourly_withcap(param_hours4x6nonstd);
        //hours4x6 = result.total;

        // Now allocate all incentive hours.
        var result = system_hourly_withcap(param_incentive);
    }
};


xemo.core.splitshiftinplaceby = function (shifts, ndx, by) {
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

xemo.core.splitshiftsby = function (shifts, by) {
    for (var i = 0; i < shifts.length; ++i) {
        if (xemo.core.splitshiftinplaceby(shifts, i, by)) {
        }
    }
}


function plugin_pay_calculator(perdata, paysysinfo, pids, nonpidnames, calls, shifts, key, from, to, cfg, cb) {
    var master = {};

    master.paysysinfo = paysysinfo;
    master.perdata = perdata;
    master.warnings = [];

    // pay period.. 7/9/2015 - 7/23/2015

    // First, we need to determine what pay period we are currently in.
    //var pp_start = new Date(2015, 7 - 1, 9, 6);
    //var pp_end = new Date(2015, 7 - 1, 23, 6);
    
    var firstdayofrange = new Date(from.year, from.month - 1, from.day, from.hour);
    var lastdayofrange = new Date(to.year, to.month - 1, to.day, to.hour);

    master['from'] = firstdayofrange;
    master['to'] = lastdayofrange;

    xemo.core.log(10, '{0}-{1}-{2}'.format(to.year, to.month, to.day));
    xemo.core.log(10, 'doing {0} to {1}<br/>'.format(firstdayofrange, lastdayofrange));
    xemo.core.log(10, 'shifts.length:' + shifts.length + '<br/>');

    var __cache = [];

    for (var x = 0; x < shifts.length; ++x) {
        shifts[x].events = [];
        for (var z = 0; z < calls.length; ++z) {
            var calldate = new Date(calls[z][1] * 1000.0);
            if (calldate >= shifts[x].start && calldate < shifts[x].end) {
                var event = new ShiftEvent(calldate, 'ems-call');
                event.id = calls[z][0];
                event.crewid = calls[z][2];
                event.disposition = calls[z][3];
                shifts[x].events.push(event);
            }
        }
    }

    /*
        Any shift with out a personnel ID has not pay system applied.
    */
    xemo.core.log(10, 'Enumerating pay systems for personnel.');
    for (var pid in pids) {
        pid = parseInt(pid);

        if (pid in paysysinfo['mapping']) {
            xemo.core.log(10, 'pay system({0}) selected for pid({1})'.format(paysysinfo['mapping'][pid], pid));
        }
    }


    /*
        Go ahead and split shifts that lay on the range boundaries.
    */
    xemo.core.splitshiftsby(shifts, firstdayofrange);
    xemo.core.splitshiftsby(shifts, lastdayofrange);

    /*
        Find all unique pay period reference points.
    */
    var payperiodrefs = {};
    for (var sysid in paysysinfo['systems']) {
        var payperiodref = paysysinfo['systems'][sysid].payperiodref;
        payperiodrefs[payperiodref] = true;
    }

    /*
        Break all shifts that span a pay period boundary of 7 days.st This
        also includes incentive drivers. We will recombine incentive shifts
        later in order to make 12-hour shift calculations easier.
    */
    for (var i = 0; i < shifts.length; ++i) {
        var shift = shifts[i];

        // Only break according to pay period ref for this shift.
        var payperiodref;
        if (!shift.pid) {
            payperiodref = new Date(2015, 7 - 1, 9, 6);
        } else {
            payperiodref = new Date(paysysinfo.ppref[shift.pid] * 1000);
        }

        var result = xemo.core.getpayperiodidbydate(shift.start, 2, payperiodref);
        var start_pp = result[1];
        shift.payperiod14 = result[0];
        shift.payperiod7 = result[1];

        var result = xemo.core.getpayperiodidbydate(shift.end, 2, payperiodref);
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
            shift.end = start_pp[1]; // ends on next pay period
            newshift.isValid();
            shift.isValid();
            // Insert new shit after this shift.
            shifts.splice(i + 1, 0, newshift);
            // Advance index so we skip over the newly inserted shift.
            ++i;
        } 
    }

    xemo.core.waitShow('Applying pay systems...');
    for (var pid in paysysinfo['mapping']) {
        var sys_sel = paysysinfo.mapping[pid];

        //var sysid = paysysinfo['mapping'][pid];
        //var specs = paysysinfo['systems'][sysid];
        //var sysname = specs.sysname;
        //var config = specs.config;

        var payperiodref = new Date(paysysinfo.ppref[pid] * 1000);

        var result = xemo.core.getpayperiodidbydate(firstdayofrange, 1, payperiodref);
        var cur_pp_start = result[0];
        var cur_pp_end = result[1];
        for (; cur_pp_start <= lastdayofrange; cur_pp_start.setDate(cur_pp_start.getDate() + 7), cur_pp_end.setDate(cur_pp_end.getDate() + 7)) {
            // Find the pay system that applies to this pay period.
            var ppid = Math.floor(cur_pp_start.getTime() / 1000.0 / 60.0 / 60.0 / 24.0 / 7.0);

            var sysid = null;
            var specs;
            var sysname;
            var config;
            for (var x = 0; x < sys_sel.length; ++x) {
                if (sys_sel[x].start <= ppid && sys_sel[x].end >= ppid) {
                    if (sysid != null) {
                        sysid = null;
                        break;
                    }
                    sysid = sys_sel[x].sysid;
                }
            }

            if (sysid == undefined || sysid == null) {
                master.warnings.push('The personnel({0}) named {1} did not have a pay system applied for the pay period of {2}, because none matching start and end was found.'.format(
                    pid, pids[pid], cur_pp_start
                ));
                continue;
            }

            specs = paysysinfo.systems[sysid];
            sysname = specs.sysname;

            if (!specs || !xemo.core.paysys[sysname]) {
                master.warnings.push('The personnel({0}) named {1} did not have a pay system applied for the pay period of {2}, because the pay system specified as {3}:{4} did not exist.'.format(
                    pid, pids[pid], cur_pp_start, sysid, sysname
                ));
                continue;
            }

            config = specs.config;

            xemo.core.paysys[sysname](
                {
                    config:       config,
                    specs:        specs,
                    payperiodref: payperiodref,
                    shifts:       shifts,
                    ppstart:      cur_pp_start,
                    ppend:        cur_pp_end,
                    calls:        calls,
                    pid:          pid
                }
            );
        }
    }

    master['shifts'] = shifts;
    cb(master);
}

xemo.core.system_incentive = function (params) {
    var shifts = params.shifts;
    var pid = params.pid;
    var ppstart = params.ppstart;
    var ppend = params.ppend;

    xemo.core.waitShow('Doing incentive allocations..');
    for (var i = 0; i < shifts.length; ++i) {
        var shift = shifts[i];

        // Only do shifts for the specified PID.
        if (shift.pid != pid) {
            continue;
        }

        // Ignore shifts outside the range, even if they are somewhat in it.
        if (shift.start < ppstart || shift.start >= ppend || shift.end < ppstart || shift.end >= ppend) {
            continue;
        }

        // Ignore shifts already allocated.
        if (shift.allocatedfor != null) {
            continue;
        }

        // How many twelve hour shifts do we have in this shift?
        var hours = (shift.end - shift.start) / 1000.0 / 60.0 / 60.0;

        if (hours < 0.0) {
            warn('The hours for a shift entry showed a starting time before and ending time!');
        }
        
        var hr12shifts = Math.floor(hours / 12.0);
        var lefthours = hours - hr12shifts * 12.0;

        // Add data to just the specific shift.
        shift.info_incentive = {};
        shift.info_incentive.dollars = cfg.incpayper12hrshift * hr12shifts + cfg.incpayperhour * lefthours;        

        var numcalls = 0;
        var numtransports = 0;

        for (var x = 0; x < shift.events.length; ++x) {
            if (shift.events[x].isEMSCall()) {
                ++numcalls;
                if (shift.events[x].isEMSTransport()) {
                    ++numtransports;
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
        xemo.core.log(10, 'name:{0} id:{1} beginpay:{2} endpay:{3} paydiff:{4} hr12shifts:{5} hours:{6} numcalls:{7} numtransports:{8} start:{9} end:{10}<br/>'.format
        (
            curpay.name, curpay.pid, dbg, curpay.incentivedollars, curpay.incentivedollars - dbg, hr12shifts, hours,
            numcalls, numtransports, shift.start, shift.end
        ));
        //}
    }

    master['shifts'] = shifts;

    xemo.core.waitHide();
    cb(master);
}

function plugin_attributes_fetch(key, ids, cb) {
    for (var x = 0; x < ids.length; ++x) {
        ids[x] = String(ids[x]);
    }
    xemo.core.sop({
        op:    'get_personnel_attributes',
        key:    key,
        ids:    ids.join(',')   
    }, function (data) {
        cb(data.result);
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

    xemo.core.log(10, 'RNG-RAW-INPUT ' + to_year + '-' + to_month + '-' + to_day + '<br/>');

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

    xemo.core.waitShow('Fetching calendar data..');
    plugin_schedule_fetchmonth(key, from_year, from_month, from_day, to_year, to_month, to_day, group, 
        function (shifts) {
            xemo.core.waitShow('Fetching personnel data..');
            xemo.core.waitShow('Fetching calls..');
            plugin_calls_fetch(key, from_year, from_month, from_day, to_year, to_month, to_day,
                function(calls) {
                    xemo.core.waitShow('Enumerating personnel IDs..');
                    xemo.core.fetchPersonnelData(key, function (perdata) {
                            var pids = {}
                            var nonpidnames = {};

                            for (var x = 0; x < shifts.length; ++x) {
                                // Try to resolve the name into a personnel ID.
                                var result = xemo.core.getPersonnelIDFromName(perdata, shifts[x].name, shifts[x].start);
                                if (result[0] == 1) {
                                    shifts[x].pid = result[1];
                                }
                                if (result[0] == -1) {
                                    shifts[x].pid_resolution_error = 'ambiguous name with: ' + result[1].join(', ');
                                }
                                if (result[0] == 0) {
                                    shifts[x].pid_resolution_error = 'name could not be matched';
                                }
                                // 
                                if (shifts[x].pid == null) {
                                    nonpidnames[shifts[x].name] = true;
                                } else {
                                    pids[shifts[x].pid] = shifts[x].name;
                                }
                            }

                            var tmp = [];
                            for (var pid in pids) {
                                tmp.push(pid);
                            }

                            xemo.core.waitShow('Fetching pay system specifications..');
                            xemo.core.getPaySystemInfo(key, tmp, function (paysysinfo) {
                                xemo.core.waitShow('Combining consecutive shifts..');
                                xemo.core.shifts.combineadjshifts(shifts);
                                xemo.core.shifts.checkvalid(shifts);
                                plugin_pay_calculator(
                                    perdata,
                                    paysysinfo,
                                    pids,
                                    nonpidnames,
                                    calls, shifts, key, 
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
    });
}

function plugin_schedule_init() {

}

xemo.core.getPersonnelIDFromName = function (pdata, name, reldate) {
    var foundpid = undefined;
    var matches = [];
    var fullname = null;

    if (name in xemo.core.getPersonnelIDFromName.cache) {
        return [1, xemo.core.getPersonnelIDFromName.cache[name][0], xemo.core.getPersonnelIDFromName.cache[name][1]];
    }

    name = name.toLowerCase();
    for (var pid in pdata) {
        var f = pdata[pid].firstname;
        var m = pdata[pid].middlename;
        var l = pdata[pid].lastname;
        var u = pdata[pid].surname;
        var edate = new Date(pdata[pid].dateadded * 1000);

        if (edate != undefined && reldate != undefined && edate > reldate) {
            // This personnel was added after this point
            // in time represented by reldate. So do not
            // even consider them.
            continue;
        }

        function chbfield(v, ndx) {
            return (v >> (ndx * 2)) & 0x3;
        }

        var parts = [f, m, l, u];

        for (var x = 1; x < 256; ++x) {
            var o = [];
            for (var y = 0; y < 4; ++y) {
                switch (chbfield(x, y)) {
                    case 0: continue;
                    case 1: o.push(parts[y]); break;
                    case 2: o.push(parts[y].substring(0, 1)); break;
                    case 3: continue;
                }
            }
            o = o.join(' ');
            if (name == o) {
                foundpid = pid;
                fullname = (f + ' ' + m + ' ' + l + ' ' + u).trim()
                matches.push(fullname);
                break;
            }
        }
    }

    if (matches.length > 1) {
        return [-1, matches];
    }

    if (matches.length == 0) {
        return [0, undefined];
    }

    xemo.core.getPersonnelIDFromName.cache[name] = [foundpid, fullname];
    return [1, parseInt(foundpid), fullname];
}
xemo.core.getPersonnelIDFromName.cache = {};

xemo.core.opendoc = function (key, ext, contents) {
    xemo.core.sop({
        key:    key,
        op:     'gen_document',
        data:   contents,
        ext:    ext
    }, function (data) {
        alert('opening window: ' + data.result);
        var mw = window.open('/' + data.result);
    });
};

xemo.core.objtojson_string_escape = function (s) {
    var out = [];
    for (var x = 0; x < s.length; ++x) {
        switch (s[x]) {
            case '\n':
                out.push('\\n');
                break;
            case '"':
                out.push('\\"');
                break;
            default:
                out.push(s[x]);
                break;
        }
    }
    return out.join('');
}

xemo.core.objtojson_write_value = function (val) {
    switch (typeof(val)) {
        case 'object':
            return xemo.core.objtojson(val);
        case 'boolean':
            return val ? 'true' : 'false';
        case 'number':
            return val;
        default:
            return '"' + xemo.core.objtojson_string_escape(val) + '"';
    }
}

xemo.core.objtojson = function (obj) {
    var out = [];

    if (obj.length != undefined) {
        out.push('[');
        for (var x = 0; x < obj.length; ++x) {
            out.push(xemo.core.objtojson_write_value(obj[x]));
            out.push(', ');
        }
        out.pop();
        out.push(']');
    } else {    
        out.push('{');
        out.push(' ');
        for (var k in obj) {
            out.push('"' + k + '": ')
            out.push(xemo.core.objtojson_write_value(obj[k]));
            out.push(', ');
        }
        out.pop();
        out.push('}');
    }

    return out.join('');
}

xemo.core.objtoxml = function (rootname, obj, xsl) {
    var out = [];

    if (xsl != false) {
        out.push('<?xml version="1.0" encoding="UTF-8" ?>\n');
        if (xsl != undefined) {
            out.push('<?xml-stylesheet type="text/xsl" href="' + xsl + '"?>\n');
        }
    }

    var params = [];
    for (var k in obj) {
        if (k.indexOf('_') == 0) {
            var _k = k.substring(1);
            params.push(_k + '="' + obj[k] + '"');
            continue;
        }
    }

    if (obj.length != undefined) {
        // object as an array
        for (var x = 0; x < obj.length; ++x) {
            if (typeof(obj[x]) == 'object') {
                out.push(xemo.core.objtoxml(rootname, obj[x], false));
                continue;
            }

            out.push('<' + rootname + '>' + obj[k] + '</' + rootname + '>');
        }
    } else {
        out.push('<' + rootname + ' ' + params.join(' ') + '>');
        // object with members
        for (var k in obj) {
            if (k.indexOf('_') == 0) {
                continue;
            }

            // object members (maybe array)
            if (typeof(obj[k]) == 'object') {
                out.push(xemo.core.objtoxml(k, obj[k], false));
                continue;
            }

            // value member
            out.push('<' + k + '>' + obj[k] + '</' + k + '>');
        }
        out.push('</' + rootname + '>');
    }

    return out.join('');
}

xemo.core.fetchPersonnelData = function (key, cb) {
    xemo.core.sop({
        key:     key,
        op:      'get_personnel_data'
    }, function (data) {
        cb(data.result);
    });
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

    xemo.core.sop({
        key:     key,
        names:   names.join(',')
    }, function (data) {
        var nametoid = data.result.mapping;
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

xemo.core.getPersonnelNamesFromIDs = function (key, ids, cb) {
    xemo.core.sop({
        key:   key,
        ids:   ids.join(','),
        op:    'get_personnel_names'
    }, function (data) {
        if (data.code == 'success') {
            cb(true, data.result);
        } else {
            cb(false, undefined);
        }
    });
}

function plugin_calls_fetch(key, from_year, from_month, from_day, to_year, to_month, to_day, cb) {
    xemo.core.sop({
        key:          key,
        from_year:    from_year,
        from_month:   from_month,
        from_day:     from_day,
        to_year:      to_year,
        to_month:     to_month,
        to_day:       to_day,
        op:           'readcalls'
    }, function (data) {
        cb(data.result);
    });
}

function render_calender(year, month, group) {
    alert('NOT IMPLEMENTED');
    $.xxx('v1api.py?key={0}&grp={1}&year={2}&month={3}&op=readmonth'.format(
        i_key.value, group, year, month 
    ), function (data) {
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


xemo.core.textcalendar = {};
xemo.core.shifts = {};

xemo.core.shifts.checkvalid = function (shifts) {
    for (var x = 0; x < shifts.length; ++x) {
        if (!shifts[x].isValid()) {
            alert('WHOA HORSEY..');
        }
    }
}

xemo.core.shifts.combineadjshifts = function (shifts) {
    for (var x = 1; x < shifts.length; ++x) {
        var pshift = shifts[x-1];
        var shift = shifts[x];

        // Is this shift the same person?
        if (pshift.samePersonnelAs(shift)) {
            // Do they overlap?
            if (
                (pshift.start >= shift.start && pshift.start <= shift.end) ||
                (shift.start >= pshift.start && shift.start <= pshift.end)
            ) {
                // Combine the shifts.
                var nstart;
                if (shift.start < pshift.start) {
                    nstart = shift.start;
                } else {
                    nstart = pshift.start;
                }

                var nend;
                if (shift.end > pshift.end) {
                    nend = shift.end;
                } else {
                    nend = pshift.end;
                }

                shift.start = nstart;
                shift.end = nend;

                if (!shift.isValid()) {
                    alert('invalid shift..');
                }

                // Remove the previous shift.
                shifts.splice(x - 1, 1);

                --x;
                continue;
            }
        }
    }
}

/*
    BROKEN...
*/
xemo.core.textcalendar.refineRoughShiftsOverlapping = function (shifts, datemake) {
    var last_old_start = null;

    for (var x = 0; x < shifts.length; ++x) {
        var shift = shifts[x];

        // [0]:   hour with fractional hour
        // [1]:   whole hour in 24-hour format
        // [2]:   whole minutes

        shift.pid = null;
        shift.allocatedfor = null;        

        var old_start = shift.start;
        var old_end = shift.end;

        shift.start = new Date(shift.year, shift.month - 1, shift.day, shift.start[1], shift.start[2]);

        if (old_start[0] == old_end[0]) {
            // This is a 24 hour shift.
            shift.end = new Date(shift.year, shift.month - 1, shift.day + 1, shift.end[1], shift.end[2]);
            continue;
        }

        if (old_end[0] < old_start[0]) {
            // It extends into the next day, but less than 24 hours.
            shift.end = new Date(shift.year, shift.month - 1, shift.day + 1, shift.end[1], shift.end[2]);
            continue;
        }

        // Both are on the same day.
        shift.end = new Date(shift.year, shift.month - 1, shift.day, shift.end[1], shift.end[2]);

        if (!shift.isValid()) {
            alert('WHOA SNAKEY..');
        }

        last_old_start = old_start;
    }
}

xemo.core.textcalendar.refineRoughShifts = function (
    out, datemake
) {
    // This performs two functions:
    //      (1) it converts the start and end time into a complete date and time
    //      (2) it handles cases wheres shifts reach into the next day
    var triggered = false;
    var triggered_mark = -55;
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
        if (i > 0 && out[i].start[0] == 0.0) {
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
            if (datemake) {
                out[i].start = datemake(out[i].year, out[i].month - 1, sday, out[i].start[1], out[i].start[2]);
                out[i].end = datemake(out[i].year, out[i].month - 1, eday, out[i].end[1], out[i].end[2]);
            } else {
                out[i].start = new Date(out[i].year, out[i].month - 1, sday, out[i].start[1], out[i].start[2]);
                out[i].end = new Date(out[i].year, out[i].month - 1, eday, out[i].end[1], out[i].end[2]);
            }
        }
    }

    // Set the few basically required members.
    for (var i = 0; i < out.length; ++i) {
        out[i].pid = null;
        out[i].allocatedfor = null;
    }
}

/*
    A rough shift is actually an invalid shift as most shift methods
    will not function properly. However, in order to refine the shift
    we need to have all other shifts. This is because a day may specify
    shifts that extend into the next day or actually start in the next
    day.
*/
xemo.core.textcalendar.makeRoughShift = function (
    year, month, day, name, start, end
) {
    var shift = new Shift();
    
    name = name.toLowerCase().replace('.', '').trim();
    
    while (name.indexOf('__') > -1) {
        name = name.replace('__', '_');
    }
    
    if (name == '_') {
        name = '<nobody>';
    }

    shift.name = name;
    shift.year = year;
    shift.month = month;
    shift.day = day;
    shift.start = start;
    shift.end = end;
    return shift;
}

/*
    This takes an array of strings representing lines. It converts them
    into shifts by calling the specified callback function for each one.

    Note: Further refinement of the shifts can be done by calling
          xemo.core.textcalendar.refineRoughShifts, but before that
          you must convert each shift into a Shift object.

    @param:   lines
    @param:   cb
*/
xemo.core.textcalendar.isNumeric = function (v) {
    try {
        var x = parseInt(v);
        return true;
    } catch (err) {
        return false
    }
}

xemo.core.textcalendar.parseLinesIntoShifts = function (
    lines, cb
) {
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
                if (!xemo.core.textcalendar.isNumeric(pair.substring(pair.length - 1))) {
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
            if (range.indexOf('-') < 0) {
                return undefined;
            }
            var pair = range.split('-');
            return [parsetimepair(pair[0]), parsetimepair(pair[1])];
        }

        var rng = null;
        var x = 0;
        for (; x < parts.length; ++x) {
            if (xemo.core.textcalendar.isNumeric(parts[x].substring(0, 1))) {
                // This should be the time range.
                rng = parsetimerange(parts[x]);
                if (rng == undefined) {
                    continue;
                }
                if (isNaN(rng[0][0])) {
                    //warn('Report abnormal condition.');
                }
                break;
            }
        }

        //alert(line + ':' + rng[0] + ':' + rng[1]);
        if (rng != null) {
            var name = parts.slice(0, x).join(' ');
            if (name == '') {
                name = '<nobody>';
            }
            cb(name, rng[0], rng[1]);
        }
    }
}


xemo.core.getPaySystemInfo = function (key, ids, cb) {
    xemo.core.sop({
        key:    key,
        ids:    ids.join(','),
        op:     'getpaysysinfo'
    }, function (data) {
        if (!data) {
            cb(undefined);
        }
        var result = data['result'];
        cb(result);
    });
}

function plugin_schedule_fetchmonth(key, from_year, from_month, from_day, to_year, to_month, to_day, group, cb) {
    xemo.core.sop({
        key:        key,
        grp:        group,
        from_year:  from_year,
        from_month: from_month,
        from_day:   from_day,
        to_year:    to_year,
        to_month:   to_month,
        to_day:     to_day,
        op:         'readcalendar'
    }, function (data) {
        var result = data.result;
        var out = [];

        for (var i = 0; i < result.length; ++i) {
            // Read the record fields.
            var year = result[i][0];
            var month = result[i][1];
            var day = result[i][2];
            var txt = result[i][3];

            var lines = txt.split('\n');
            xemo.core.textcalendar.parseLinesIntoShifts(lines, function (name, start, end) {
                var shift = xemo.core.textcalendar.makeRoughShift(year, month, day, name, start, end);
                out.push(shift);                
            });
        }

        xemo.core.textcalendar.refineRoughShifts(out);

        cb(out);
    });
}

function ShiftEvent(date, type) {
    this.date = date;
    this.type = type;
}

ShiftEvent.prototype.isEMSCall = function () {
    if (this.type == 'ems-call') {
        return true;
    }
    return false;
}

ShiftEvent.prototype.isEMSTransport = function () {
    if (!this.isEMSCall()) {
        return false;
    }
    // 5: no transport
    // 6: cancelled
    // 7: fd call
    // 9: no pt found                
    if (this.disposition == 5 || this.disposition == 6 || this.disposition == 7 || this.disposition == 9) {
        return false;
    }
    return true;
}

function Shift() {
    this.start = null;
    this.end = null;
    this.events = [];
    return this;
}

Shift.prototype.clone = function () {
    // Do a rough shallow copy.
    var no = new Shift();
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
        oshift.isValid();
        nshift.isValid();
        return [oshift, nshift];
    }
    return null;
}

Shift.prototype.getTimeDuration = function () {
    return this.end.subtractTimeConsideringTimezone(this.start);
}

Shift.prototype.isValid = function () {
    if (this.end.getTime() < this.start.getTime()) {
        alert('shift end < start');
        return false;
    }
    if (this.end.getTime() == this.start.getTime()) {
        alert('shift end == start');
        return false;
    }

    return true;
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

/*
    (See Shift.prototype.adjustEnd)
*/
Shift.prototype.adjustStart = function (hours) {
    this.start.adjustdatebyfphours(hours);
    this.dropEventsNotCovered();
}

/*
    This function is important to use instead of manually
    manipulating the end member, because it also drops any
    events that are no longer on the shift after the shift
    end time is adjusted.
*/
Shift.prototype.adjustEnd = function (hours) {
    this.end.adjustdatebyfphours(hours);
    this.dropEventsNotCovered();
}

/*
    This goes through the event list for the shift and drops
    any event that is no longer between the shift start and
    end times. This is primarily used internally when a shift
    is split in order to drop out whatever event fell on the
    other side.
*/
Shift.prototype.dropEventsNotCovered = function () {
    for (var z = 0; z < this.events.length; ++z) {
        if (this.events[z].date < this.start || this.events[z].date > this.end) {
            this.events.splice(z, 1);
            --z;
        }
    }
}

Shift.prototype.samePersonnelAs = function (shift) {
    if (this.pid == undefined && shift.pid == undefined) {
        if (this.name == shift.name) {
            return true;
        }
        return false;
    }

    if (this.pid == shift.pid && this.pid != undefined) {
        return true;
    }

    return false;
}

Shift.prototype.excludeafter = function (by, reverse) {
    if (reverse) {
        if (this.end <= by) {
            return null;
        }
    } else {
        if (this.start >= by) {
            return null;
        }
    }

    var result = this.splitby(by);
    if (result != null) {
        if (reverse) {
            return result[1];
        }
        return result[0];
    }
    return this;
};

Shift.prototype.excludebefore = function (by) {
    return this.excludeafter(by, true);
}

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

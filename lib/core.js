String.prototype.format = function () {
    var args = arguments;
    return this.replace(/\{\{|\}\}|\{(\d+)\}/g, function (m, n) {
        if (m == "{{") { return "{"; }
        if (m == "}}") { return "}"; }
        return args[n];
    });
};

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

// Allows the cloning of the Date object and provides a layer of
// abstraction if problem arise.
Date.prototype.clone = function () {
    return new Date(this.getTime());
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

    // The best reasonable hours allocator.
    function __b(allocated, totalhours, pps, ppe) {
        __log(10, 'doing best reasonable hours allocate for {0} to {1}<br/>'.format(pps, ppe));
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
                    });
                    __log(10, 'only ' + (tmp + totalhours) + ' in 1/2 pay period.. no need for premutation algo.. took all remaining hours and shifts..<br/>');
                    if (tmp + totalhours == cap) {
                        dayshifts[i][x].allocatedfor = 'SYSTEM.HOURLY_WITHCAP(' + cap + '); NON-STANDARD-HOURS;';
                    } else {                             
                        dayshifts[i][x].allocatedfor = 'SYSTEM.HOURLY_WITHCAP(' + cap + '); NON-STANDARD-HOURS;';
                    }
                }
            }
            return tmp + totalhours;
        }

        var tmp = 0;
        var fiddle = 8;
        while (totalhours + tmp < cap) {
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

        var bestmap = null;
        var bestcount = -1;

        function work_premutate_map(p, pretend) {
            var transportcount = 0;
            var toinsert = {};
            for (var x = 0; x < p.length; ++x) {
                var ndx = p[x];
                // Try to take 8 hours minimum and maximum.
                for (var y = 0; y < dayshifts[ndx].length; ++y) {
                    var shift = dayshifts[ndx][y];
                    var totalshifthours = (shift.__end - shift.start) / 1000.0 / 3600.0;
                    var need = cap - totalhours;
                    if (need <= 0) {
                        break;
                    }
                    // The fiddle will cap the maximum hours to grab.
                    if (need > fiddle) {
                        need = fiddle;
                    }
                    if (totalshifthours > need) {                                    
                        // What would we have made in incentive? Find all calls
                        // inside the remaining shift.
                        var nstart = shift.start.clone();
                        nstart.setHours(nstart.getHours() + need);

                        for (var z = 0; z < calls.length; ++z) {
                            var calldate = calls[z][1];
                            var calldis = calls[z][3];
                            if (isDispositionATransport(calldis)) {
                                if (calldate >= nstart && calldate < shift_end) {
                                    ++transportcount;
                                }
                            }
                        }

                        if (!pretend) {
                            __log(10, 'B. took {0} hours from {1} to {2}<br/>'.format(need, shift.start, shift.end));
                            var nshift = shift.clone();
                            nshift.start.setHours(shift.start.getHours() + need);
                            shift.end = nshift.start.clone();

                            totalhours += need;
                            allocated.push({
                                'start':          shift.start.clone(),
                                'end':            shift.end.clone(),
                            });

                            nshift.allocatedfor = null;
                            shift.allocatedfor = 'SYSTEM.HOURLY_WITHCAP(' + totalhours + '/'  + cap + '); NON-STANDARD-HOURS[' + bestcount + '];';

                            toinsert[shift.__ndx + 1] = nshift;
                        }                                     
                    } else {
                        // We are going to just remove the entire shift.
                        if (!pretend) {
                            __log(10, 'B. took all hours from {0} to {1}<br/>'.format(shift.start, shift.end));
                            allocated.push({
                                'start':          shift.start.clone(),
                                'end':            shift.__end.clone(),
                            });
                            // Make the shift equal to zero hours.
                            totalhours += totalshifthours;
                            shift.allocatedfor = 'SYSTEM.HOURLY_WITHCAP(' + totalhours + '/' + cap + '); NON-STANDARD-HOURS[' + bestcount + '];';
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

            return transportcount;
        }

        var map = [0, 1, 2, 3, 4, 5, 6];
        permutate(map, function(p) {
            // Work the premutate map, but just pretend to actually do it.
            var transportcount = work_premutate_map(p, true);
            //__log(10, 'work_premutate_map got transportcount of ' + transportcount + '<br/>');
            // Track the best transport count.
            if (transportcount > bestcount) {
                bestcount = transportcount;
                bestmap = p.slice();
            }
        });

        // Actually do the premutate map.
        __log(10, 'working best map with transportcount of ' + bestcount + ' for totalhours of ' + totalhours + '<br/>');
        work_premutate_map(bestmap, false);
        
        return totalhours;                             
    }


    // The standard hours allocator.
    function __a(allocated, totalhours, pps, ppe) {
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

            if (shifts[i].start.getDay() < 1 || shifts[i].start.getDay() > 5) {
                // Only do days Monday through Friday.
                continue;
            }

            var bya = shifts[i].start.clone();
            bya.setHours(6);
            var byb = shifts[i].end.clone();
            byb.setHours(2);
            var result = shifts[i].splitbymulti([bya, byb]);
            if (result.length > 0) {
                result.splice(0, 0, 1);
                result.splice(0, 0, i);
                shifts.splice.apply(result);
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
            if (shifts[i].start.getHours() == 6 && shifts[i].start.getDay() >= 1 && shifts[i].start.getDay() <= 5) {
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
                    nshift.start.setHours(shifts[i].start.getHours() + need);
                    shifts[i].end = nshift.start.clone();

                    allocated.push({
                        'start':          shifts[i].start.clone(),
                        'end':            shifts[i].end.clone(),
                    });

                    nshift.allocatedfor = null;
                    shifts[i].allocatedfor = 'SYSTEM.HOURLY_WITHCAP(' + totalhours + '/' + cap + '); STANDARD-HOURS;';

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
                    });                                
                    shifts[i].allocatedfor = 'SYSTEM.HOURLY_WITHCAP(' + totalhours + '/' + cap + '); STANDARD-HOURS;';
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

    var ret = {};
    // Each pay period is two weeks. So we need to do this computation
    // twice for each week.
    var a_allocated = [];
    var tmp = cur_pp_start.clone();
    tmp.setDate(tmp.getDate() + 7);
    var totalhours = __a(a_allocated, 0.0, cur_pp_start, tmp);
    __log(10, 'A.1: total hours was {0} of {1}<br/>'.format(totalhours, cap));
    if (totalhours < cap) {
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
    if (totalhours < cap) {
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
}

function warn(msg) {
    alert('A warning was issued. Please tell Kevin:\n' + msg);
}

function plugin_pay_calculator(pidattrib, calls, shifts, key, from, to, cfg, cb) {
    var master = {};

    master['systems'] = {};
    master['systems']['hourly_withcap'] = {};

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

    function getpayperiodidbydate(d) {
        var __pp_start = pp_start.clone();
        var __pp_end = pp_end.clone();
        var tmp = new Date(2015, 4, 30, 14);
        var dbg = false;
        if (d < __pp_start) {
            for (; d < __pp_start; __pp_start.setDate(__pp_start.getDate() - 14), __pp_end.setDate(__pp_end.getDate() - 14)) {
            }
        } else {
            // Only increment if the day is greater than the end of the currently specified pay period.
            for (; d >= __pp_end; __pp_start.setDate(__pp_start.getDate() + 14), __pp_end.setDate(__pp_end.getDate() + 14));
        }
        //var t = __pp_start;
        //var yearstart = new Date(t.getYear(), 0, 1, t.getHours(), t.getMinutes());
        //alert('for {0} the pay period is {1} to {2}'.format(d, __pp_start, __pp_end));
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


    // (1) add a pay period identifier to every shift
    // (2) split shifts crossing pay period boundaries for special personnel
    for (var i = 0; i < shifts.length; ++i) {
        var shift = shifts[i];
        var start_pp = getpayperiodidbydate(shift.start);
        shift.payperiod = start_pp;

        if (shift.pid != null && ($.inArray(shift.pid, incentive_calulation_lock_for_payperiod_who) > -1)) {
            var end_pp = getpayperiodidbydate(shift.end);
            // See if we need to split the shift..
            if (start_pp[0].getTime() != end_pp[0].getTime()) {
                __log(10, 'debug of {0} to {1}<br/>'.format(shift.start, shift.end));
                __log(10, ' period #1 {0} to {1}<br/>'.format(start_pp[0], start_pp[1])); 
                __log(10, ' period #2 {0} to {1}<br/>'.format(end_pp[0], end_pp[1]));
                // Break the shift into two shifts.
                if (end_pp[0] - shift.end == 0) {
                    continue;
                }
                var newshift = shift.clone();
                newshift.start = start_pp[1].clone();
                newshift.payperiod = end_pp;
                shift.end = start_pp[0]; // ends on start pay period
                // Insert new shit after this shift.
                shifts.splice(i + 1, 0, newshift);
                // Advance index so we skip over the newly inserted shift.
                ++i;
                __log(10, 'split shift for {0} into {1} .. {2} .. {3}<br/>'.format(
                    shift.name, shift.start, newshift.start, newshift.end
                ));
                __log(10, '  {0}-{1}<br/>    {2}-{3}<br/>'.format(
                    start_pp[0], start_pp[1],
                    end_pp[0], end_pp[1]
                ));
            } 
        }                    
    }

    // APPLY THE PAY SYSTEMS FOR EACH PERSONNEL
    for (var i = 0; i < incentive_calulation_lock_for_payperiod_who.length; ++i) {
        var pid = incentive_calulation_lock_for_payperiod_who[i];
        var cap = personnel_cap[pid];

        master['systems']['hourly_withcap'][pid] = [];

        var cur_pp_start = pp_start.clone();
        var cur_pp_end = pp_end.clone();
        for (; cur_pp_start <= lastdayofrange; cur_pp_start.setDate(cur_pp_start.getDate() + 14), cur_pp_end.setDate(cur_pp_end.getDate() + 14)) {
            __log(10, 'doing payperiod {0} to {1}<br/>'.format(cur_pp_start, cur_pp_end));
            ///////////////////////////
            var ret = system_hourly_withcap({
                'shifts':         shifts,
                'cur_pp_start':   cur_pp_start,
                'cur_pp_end':     cur_pp_end,
                'cap':            cap,
                'pid':            pid,
                'calls':          calls, 
            });
            // We can calculate actual pay from `total` hours now.
            // ret.a.total
            // ret.a.shifts
            // ret.b.total
            // ret.b.shifts

            // Make sure to track this system's work.
            master['systems']['hourly_withcap'][pid].push(ret.a);
            master['systems']['hourly_withcap'][pid].push(ret.b);
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
            if (!(shift.payperiod[0] in curpay.pp)) {
                curpay.pp[shift.payperiod[0]] = {};
                curpay_init(curpay.pp[shift.payperiod[0]]);
            }
            // Redirect into sub-bucket for per_payperiod == true.
            curpay = curpay.pp[shift.payperiod[0]];
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
            numtransports -= cfg.numtransportswaived;
            curpay.incentivedollars += cfg.transportpay * numtransports;
            curpay.paidtransportcount += numtransports;
        }

        if (hours < 0) {
            shift.allocatedfor = 'DEBUG';
        } else {
            shift.allocatedfor = 'STANDARD INCENTIVE';
        }

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
    alert('response:' + data);
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
                    var shift = {};
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

        var clonemethod = function () {
            // This should gracefully fail for non-existent members of the object.
            var no = {};
            no.name = this.name;
            no.year = this.year;
            no.month = this.month;
            no.day = this.day;
            no.start = this.start.clone();
            no.end = this.end.clone();
            no.allocatedfor = this.allocatedfor;
            no.pid = this.pid;
            no.clone = this.clone;
            no.payperiod = this.payperiod;
            no.splitby = this.splitby;
            no.splitbymulti = this.splitbymulti;
            no.excludeafter = this.excludeafter;
            return no;
        }

        var splitbymethod = function(by) {
            if (by > this.start && by < this.end) {
                var nshift = this.clone();
                var oshift = this.clone();
                nshift.start = by;
                oshift.end = by;
                return [oshift, nshift];
            }
            return null;
        }

        var splitbymultimethod = function(by) {
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

        var excludeaftermethod = function (by, reverse) {
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

        // Set the clone method for all shift objects.
        for (var i = 0; i < out.length; ++i) {
            out[i].clone = clonemethod;
            out[i].splitby = splitbymethod;
            out[i].splitbymulti = splitbymultimethod;
            out[i].pid = null;
            out[i].allocatedfor = null;
            out[i].excludeafter =  excludeaftermethod;
        }

        cb(out);
    });
}
xemo.CalendarModules = {};

var dbg_totalsframe = null;

xemo.CalendarModules.EFDHoursTally = function (plugin) {
    this.plugin = plugin;
    this.notesframe = document.createElement('div');
    return this;
};

xemo.CalendarModules.EFDHoursTally.prototype.get_notes_frame = function () {
    return this.notesframe;
};

xemo.CalendarModules.EFDHoursTally.prototype.get_name_to_pid_table = function () {
    return this.nametopid;
};

xemo.CalendarModules.EFDHoursTally.prototype.get_pid_to_name_table = function () {
    return this.pidtoname;
};

xemo.CalendarModules.EFDHoursTally.prototype.update = function () {
    var perdata = this.perdata;
    var shifts = [];
    var notesframe = this.notesframe;

    var cells = this.plugin.get_cells();

    for (var x = 0; x < cells.length; ++x) {
        var year = cells[x].year;
        var month = cells[x].month;
        var day = cells[x].day;
        var text = cells[x].editbox.value;

        var lines = text.split('\n');

        xemo.core.textcalendar.parseLinesIntoShifts(lines, function (name, start, end) {
            var shift = xemo.core.textcalendar.makeRoughShift(year, month, day, name, start, end);
            shifts.push(shift);                 
        });
    }

    xemo.core.textcalendar.refineRoughShifts(shifts);

    var matched_totals = {};
    var unmatched_totals = {};
    var warnings = {};
    var warning_count = 0;
    var nobody_hours = 0;

    var nametopid = {};
    var pidtoname = {};

    this.nametopid = nametopid;
    this.pidtoname = pidtoname;

    for (var x = 0; x < shifts.length; ++x) {
        var delta = (shifts[x].end - shifts[x].start) / 1000.0 / 60.0 / 60.0;
        var name = shifts[x].name;

        if (name == '<nobody>') {
            nobody_hours += delta;
            continue;
        }

        var result = xemo.core.getPersonnelIDFromName(perdata, shifts[x].name, shifts[x].start);

        switch (result[0]) {
            case 0:
                unmatched_totals[name] = unmatched_totals[name] || 0;
                unmatched_totals[name] += delta;
                warnings[name] = 'Could not be matched with any personnel.';
                ++warning_count;                
                break;
            case -1:
                unmatched_totals[name] = unmatched_totals[name] || 0;
                unmatched_totals[name] += delta;
                warnings[name] = 'Could be: ' + result[1].join(', ');
                ++warning_count;
                break;
            case 1:
                pidtoname[result[1]] = result[2];
                nametopid[result[2]] = result[1];
                matched_totals[result[2]] = matched_totals[result[2]] || 0;
                matched_totals[result[2]] += delta;
                break;
        }
    }

    $(notesframe).empty();

    if (warning_count > 0) {
        $(notesframe).append('<div class="plugCalendarWarningTableTitle">Warnings</div>');
        var tbl = document.createElement('table');
        tbl.className = 'plugCalendarWarningTable';
        for (var name in warnings) {
            $(tbl).append(['<tr><td>', name.toUpperCase(), '</td><td>', warnings[name], '</td></tr>'].join(''));
        }
        $(notesframe).append(tbl);
    }

    var modules = this.plugin.get_modules();
    var excols = {};

    for (var x = 0; x < modules.length; ++x) {
        if (modules[x].get_extra_hours_total_data) {
            var extra = modules[x].get_extra_hours_total_data();
            console.log('extra', extra);
            if (extra[0] != 0x12345678) {
                continue;
            }
            extra = extra[1];
            for (var k0 in extra) {
                for (var k1 in extra[k0]) {
                    if (!excols[k1]) {
                        excols[k1] = {};
                    }
                    console.log(k1, k0, extra[k0][k1]);
                    excols[k1][k0] = extra[k0][k1];
                }
            }
        }
    }

    dbg_totalsframe = notesframe;
    $(notesframe).append('<div class="plugCalendarHourTotalsTableTitle">Totals</div>');
    var tbl = document.createElement('table');
    tbl.className = 'plugCalendarHourTotalsTable';
    var out = ['<thead><td>Name</td><td>Hours</td>'];
    if (this.plugin.get_group() == 'driver') {
        out.push('<td>Money</td>');
    }
    var ecols = [];
    /*for (var k in excols) {
        ecols.push(k);
        out.push('<td>' + k + '</td>');
    }*/
    out.push('</thead>')
    console.log('excols', excols);
    console.log('nametopid', nametopid);
    $(tbl).append(out.join(''));
    $(tbl).append(['<tr><td>NOBODY</td><td>', nobody_hours, '</td></tr>'].join(''));
    for (var name in matched_totals) {
        var pid = nametopid[name];
        // (matched_totals[name] * 208 / 100).toFixed(2)
        var out = ['<tr><td>', name.toUpperCase(), '</td><td>', matched_totals[name], '</td>'];
        if (this.plugin.get_group() == 'driver') {
            out.push('<td>$' + (matched_totals[name] * 208 / 100).toFixed(2) + '</td>');
        }
        /*
        for (var x = 0; x < ecols.length; ++x) {
            if (!excols[ecols[x]][pid]) {
                out.push('<td></td>');
                continue;
            }

            var val = excols[ecols[x]][pid];

            if (ecols[x] == 'STANDARD INCENTIVE') {
                val = val + ' ($' + (val * 208 / 100.0).toFixed(2) + ')';
            }
            if (ecols[x] == '8x5 PAY') {
                val = val + ' ($' + (val * 8).toFixed(2) + ')';   
            }
            if (ecols[x] == '8x5 LUNCH') {
                val = val + ' ($0)';
            }            
            out.push('<td>' + val + '</td>');

        }
        */
        out.push('</tr>');
        $(tbl).append(out.join(''));
        //$(tbl).append(['<tr><td>', name.toUpperCase(), '</td><td>', matched_totals[name], '</td>'].join(''));
    }
    $(notesframe).append(tbl);    
};

xemo.CalendarModules.EFDHoursTally.prototype.data_change_delayed_tick = function (next) {
    var self = this;

    if (this.perdata == null) {
        xemo.core.fetchPersonnelData(this.plugin.get_auth_hash(), function (perdata) {
            self.perdata = perdata;
            self.update();
        });
        next();
        return;
    }

    this.update();
    next();
};

xemo.CalendarModules.PayCalc = function (plugin) {
    this.plugin = plugin;
    this.notesframe = document.createElement('div');
    this.subframe = document.createElement('div');
    var xshow = document.createElement('span');
    $(xshow).append('[.]');
    var self = this;
    xshow.onclick = function () {
        $(self.notesframe).toggle();
    };
    $(this.notesframe).hide();
    $(this.subframe).append(xshow);
    $(this.subframe).append(this.notesframe);
    this.data = null;
    return this;
};

xemo.CalendarModules.PayCalc.prototype.get_notes_frame = function () {
    return this.subframe;
};

xemo.CalendarModules.PayCalc.prototype.get_extra_hours_total_data = function () {
    return [0x12345678, this.data];
};

xemo.CalendarModules.PayCalc.prototype.update = function () {
    var config = {}
    config.incpayper12hrshift = 25.0;
    config.incpayperhour = 2.0;
    config.transportpay = 25.0;
    config.numtransportswaived = 1;
    config.fulltimehours = 40.0;
    config.parttimehours = 20.0;

    var self = this;

    var sthr;
    if (this.plugin.get_group().toLowerCase() == 'driver') {
        sthr = 6;
    } else {
        sthr = 8;
    }


    var syear = this.plugin.get_month() == 1 ? this.plugin.get_year() - 1 : this.plugin.get_year();
    var smonth = this.plugin.get_month() == 1 ? 11 : this.plugin.get_month() - 1;

    var dstart = new Date(syear, smonth, 1, sthr);
    var dend = new Date(this.plugin.get_year(), this.plugin.get_month(), 1, sthr);    

    plugin_pay_bootstrap(
        this.plugin.tk.getAuthHash(), 
        syear, smonth + 1, 1, sthr, 
        this.plugin.get_year(), this.plugin.get_month() + 1, 1, sthr, 
        this.plugin.get_group(),
        config,
        function (master) {
            self.data = {};
            self.ppdata = {};
            self.cols = [];

            var cols_tmp = {};  
            var pp7k_map = {};          

            var pp14_david = {};

            for (var x = 0; x < master.shifts.length; ++x) {
                var shift = master.shifts[x];

                //shift = shift.excludebefore(dstart);

                if (!shift) {
                    continue;
                }

                //shift = shift.excludeafter(dend);

                if (!shift) {
                    continue;
                }

                if (!self.data[shift.pid]) {
                    self.data[shift.pid] = {};
                }
                if (!shift.allocatedfor) {
                    continue;
                }

                var shift_hours = (shift.end.getTime() - shift.start.getTime()) / 1000 / 60 / 60;
                
                //console.log(shift.allocatedfor.id, (shift.end.getTime() - shift.start.getTime()) / 1000 / 60 / 60, shift.name, shift.pid, self.data[shift.pid], shift.start, shift.end);
                if (!self.data[shift.pid][shift.allocatedfor.id]) {
                    self.data[shift.pid][shift.allocatedfor.id] = 0;
                }
                self.data[shift.pid][shift.allocatedfor.id] += shift_hours;

                var pp7k = shift.payperiod7;

                if (shift.pid == 3) {
                    if (!pp14_david[shift.payperiod14]) {
                        pp14_david[shift.payperiod14] = 0;
                    }

                    pp14_david[shift.payperiod14] += shift_hours;
                }                

                if (
                    (pp7k[0] >= dstart && pp7k[0] < dend) ||
                    (pp7k[1] >= dstart && pp7k[1] < dend)
                ) {

                } else {
                    continue;
                }

                pp7k_map[pp7k] = pp7k;                

                //if (self.plugin.get_group() != 'driver' && shift.pid != 4) {
                //    continue;
                //}

                if (!self.ppdata[pp7k]) {
                    self.ppdata[pp7k] = {};
                }

                if (!self.ppdata[pp7k][shift.pid]) {
                    self.ppdata[pp7k][shift.pid] = {};
                }

                var aid = shift.allocatedfor.id;

                if (cols_tmp[aid] == undefined) {
                    self.cols.push(aid);
                    cols_tmp[aid] = self.cols.length - 1;
                }

                if (!self.ppdata[pp7k][shift.pid][aid]) {
                    self.ppdata[pp7k][shift.pid][aid] = 0;
                }

                self.ppdata[pp7k][shift.pid][aid] += shift_hours;
            }

            var modules = self.plugin.get_modules();

            var pidtoname = null;

            for (var x = 0; x < modules.length; ++x) {
                if (modules[x].get_name_to_pid_table) {
                    pidtoname = modules[x].get_pid_to_name_table();
                }
            }

            if (!pidtoname) {
                if (self.next) {
                    self.next();
                }
            }

            console.log('@@', pidtoname);

            $(self.notesframe).empty();

            for (var k in pp14_david) {
                var hours = pp14_david[k];
                if (hours < 168) {
                    var __ppd;
                    try {
                        __ppd = k.split('),')[0];
                    } catch (error) {
                        __ppd = k;
                    }
                    $(dbg_totalsframe).append(
                        '<div style="color: #cccccc; background-color: #ff9999; border: 3px outset gray; padding: 3px; margin: 3px;">David Ingram Hours Is ' + hours + '; Below 168 For Pay Period ' + __ppd + ')</div>'
                    );
                }
            }

            for (var pp7k in self.ppdata) {
                var tbl = document.createElement('table');
                tbl.className = 'calendar_paycalc_table';
                var out = [];

                out.push('<thead><td>Name</td>');
                for (var x = 0; x < self.cols.length; ++x) {
                    out.push('<td>' + self.cols[x] + '</td>');
                }
                out.push('</thead>');
                $(tbl).append(out.join(''));
                for (var pid in self.ppdata[pp7k]) {
                    if (!pidtoname[pid]) {
                        continue;
                    }

                    out = ['<tr>'];

                    out.push('<td>' + pidtoname[pid].toUpperCase() + '</td>');

                    for (var x = 0; x < self.cols.length; ++x) {
                        var aid = self.cols[x];
                        var v = self.ppdata[pp7k][pid][aid];
                        v = v ? v : '';
                        out.push('<td>' + v + '</td>');
                    }
                    out.push('</tr>');
                    $(tbl).append(out.join(''));
                }

                pp7k = pp7k_map[pp7k];
                var title = 'Pay Period: ' + pp7k[0] + ' to ' + pp7k[1];
                $(self.notesframe).append('<span class="calendar_paycalc_table_title">' + title + '</span>');
                $(self.notesframe).append(tbl);
            }

            if (self.next) {
                self.next();
            }
    });
};

xemo.CalendarModules.PayCalc.prototype.data_change_delayed_tick = function (next) {
    this.update();
    next();
};

xemo.plugins.Calendar = function (tk, frame) {
    this.name = 'Console';
    this.prefix = tk.prefix + 'console__';
    this.frame = frame;
    this.tk = tk;
    $(this.frame).empty();

    this.notesframe = document.createElement('div');

    this.modules = [];

    if (xemo.CalendarModules) {
        for (var k in xemo.CalendarModules) {
            var module = new xemo.CalendarModules[k](this);
            this.modules.push(module);
            $(this.notesframe).append(module.get_notes_frame());
        }
    }

    var params = this.tk.getURLParameters();

    this.calframe = document.createElement('table');
    this.calframe.tk = tk;

    this.controlframe = document.createElement('div');

    $(this.frame).append(this.calframe, this.controlframe, this.notesframe);    

    if ('no_menu' in params) {
        // https://github.com/kmcguire3413/xemo/issues/7
        // 
        // The removal of this code is due to the above mentioned issue.

        //var fulluilink = document.createElement('a');
        //fulluilink.textContent = '[Full Interface]';
        //fulluilink.href = 'index.html?passhash=' + encodeURI(params.passhash);
        //$(this.frame).append(fulluilink);
    }

    var plugin = this;

    this.servicetask = function () {
        var cells = plugin.cells;

        if (cells != undefined) {
            for (var x = 0; x < cells.length; ++x) {
                var cell = cells[x];
                if (cell.dirty) {
                    if (!cell.saving && cell.lastmodtime != undefined && cell.lastmodtime.getTime() + 1000 * 5 < (new Date()).getTime()) {
                        // We need to write this out so that it becomes saved.
                        cell.lastmodtime = undefined;
                        cell.saving = true;
                        cell.dirty = false;

                        //var xurl = 'v1api.py?key=' + plugin.tk.getAuthHash() + '&op=daywrite&year='
                        // + cell.year + '&month=' + cell.month + '&day=' + cell.day + '&grp=' + cell.grp + '&txt=';
                        //xurl = xurl + encodeURI(cell.editbox.value);
                        var cellref = cell;
                        xemo.core.sop({
                            key:     plugin.tk.getAuthHash(),
                            op:      'daywrite',
                            year:    cell.year,
                            month:   cell.month,
                            day:     cell.day,
                            grp:     cell.grp,
                            txt:     cell.editbox.value
                        }, function (data) {
                            if (data.result == 'success') {
                                cellref.className = 'dayCell Ready';
                                cellref.saving = false;
                            }
                        }, function () {
                            // The save failed. Make sure it stays marked as dirty.
                            cellref.dirty = true;
                            cellref.saving = false;
                        });
                    }
                }
            }
        }

        setTimeout(plugin.servicetask, 250);
    };

    //setTimeout(this.servicetask, 250);


    return this;
}

xemo.plugins.Calendar.prototype.modules_call_event = function (event) {
    var self = this;
    switch (event) {
        case 'data_change_delayed_tick':
            var x = 0;
            function call_next() {
                if (x >= self.modules.length)  {
                    return;
                }
                x = x + 1;
                try {
                    self.modules[x - 1].data_change_delayed_tick(call_next);
                } catch(error) {
                    alert('error');
                    console.log(error);
                }
            }
            call_next();
            break;
    }
};

function EnhancedTooltip(element) {
    element.lx = undefined;
    element.ly = undefined;
    element.distmoved = undefined;
    element.tooltip_shown = false;
    
    var tooltip = document.createElement('div');
    tooltip.style.position = 'absolute';
    $(tooltip).append('<b>hello</b><br/><i>world</i>');
    tooltip.style.opacity = '0.8';
    tooltip.style['z-index'] = 10;
    $(tooltip).hide();
    
    $(document.body).prepend(tooltip);
    
    element.tooltip = tooltip;
    
    element.onmouseover = function (event) {
        $(this.tooltip).show();
        this.tooltip.style.left = (event.clientX + 10) + 'px';
        this.tooltip.style.top = (event.clientY) + 'px';
    };
    
    element.onmouseout = function (event) {
        this.lx = undefined;
        this.ly = undefined;
        this.tooltip_shown = false;
        this.distmoved = undefined;
        $(this.tooltip).hide();
    };
    
    element.onmousemove = function (event) {
        element.lx = element.lx || event.clientX;
        element.ly = element.ly || event.clientY;
        element.distmoved = element.distmoved || 0;
        
        var dx = event.clientX - element.lx;
        var dy = event.clientY - element.ly;
        
        var distmoved = Math.sqrt(dx*dx+dy*dy);
        
        element.distmoved += distmoved;
         
        if (element.distmoved > 9) {
            $(this.tooltip).hide();
        }
    };
    
    return tooltip;
}

xemo.plugins.Calendar.prototype.get_modules = function () {
    return this.modules;
};

xemo.plugins.Calendar.prototype.get_auth_hash = function () {
    return this.tk.getAuthHash();
};

xemo.plugins.Calendar.prototype.get_cells = function () {
    return this.cells;
};

xemo.plugins.Calendar.prototype.generate = function (year, month, group) {
    var titlecell = document.createElement('td');
    var lnknext = document.createElement('a');
    var lnkprev = document.createElement('a');

    this.tk.waitShow('Building calendar.');

    $(this.calframe).empty();

    var monthnames = [
        'January', 'Feburary', 'March', 'April', 'May',
        'June', 'July', 'August', 'September', 'October',
        'November', 'December'
    ];

    this.cur_year = year;
    this.cur_month = month;
    this.cur_group = group;

    lnknext.className = 'linkNext';
    lnkprev.className = 'linkPrev';

    lnknext.plug = this;
    lnkprev.plug = this;

    lnknext.onclick = function () {
        var n = new Date(year, month, 1);
        lnknext.plug.generate(n.getFullYear(), n.getMonth() + 1, group);
    };

    lnkprev.onclick = function () {
        var n = new Date(year, month - 2, 1);
        lnkprev.plug.generate(n.getFullYear(), n.getMonth() + 1, group);
    }

    lnknext.textContent = '[Next]';
    lnkprev.textContent = '[Prev]';

    var titletxt = '{0} {1} {2}'.format(monthnames[month - 1], year, group);

    var grpselect = document.createElement('select');
    $(grpselect).append('<option value="driver">Driver</option>');
    $(grpselect).append('<option value="medic">Medic</option>');
    $(grpselect).append('<option value="training">Training</option>');

    grpselect.value = group;

    grpselect.plug = this;
    grpselect.onchange = function () {
        this.plug.generate(year, month, this.value);
    }

    $(titlecell).append(grpselect, lnkprev, titletxt, lnknext);

    titlecell.colSpan = '7';

    var cld = new Date(year, month, 1);
    cld.setTime(cld.getTime() - 1000 * 60 * 60 * 24);

    var sndx = (new Date(year, month - 1, 1)).getDay();
    var daycount = cld.getDate();
    var lndx = daycount + sndx;
    var cndx = 0;

    this.calframe.sndx = sndx;
    this.calframe.lndx = lndx;

    //this.calframe.style = 'background-color: white; border: 1px solid Gray; border-collapse: collapse; width: 8.5in; font-family: Georgia, Times, serif;';
    //var editboxstyle = 'padding: 0px; display: block; margin: 0px; border: none; vertical-align: top; resize: none; overflow: hidden; font-size: 80%; font-family: Arial;';
    //var tdstyle = 'border: 1px solid gray; vertical-align: top;';
    var daynumstyle = 'font-weight: bold; height: 1px; background-color: transparent;';
    
    titlecell.className = 'plugCalendar titleCell';

    $(this.calframe).append('<tr>', titlecell);

    var daynames = [
        'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'
    ];

    var tr = document.createElement('tr');
    for (var x = 0; x < daynames.length; ++x) {
        var td = document.createElement('td');
        //td.style = 'font-size: 1em; text-transform: uppercase; text-align: center; border: 1px solid Gray;';
        td.className = 'plugCalendar dayNameTitle';
        td.textContent = daynames[x];
        $(tr).append(td);
    }

    $(this.calframe).append(tr);
    this.calframe.className = 'plugCalendar';

    var cells = [];
    this.cells = cells;

    var cday = 0;

    for (var y = 0; y < 6; ++y) {
        var tr = document.createElement('tr');
        $(this.calframe).append(tr);
        for (var x = 0; x < 7; ++x) {
            var td = document.createElement('td');

            td.className = 'dayCell Ready';

            $(tr).append(td);

            if (cndx < sndx) {
                ++cndx;
                continue;
            }

            if (cells.length == daycount) {
                td.textContent = ' ';
                ++cndx;
                continue;
            }

            var editbox = document.createElement('textarea');
            var daynum = document.createElement('span');
            var overlay = document.createElement('div');

            $(td).append(daynum, editbox, overlay);

            overlay.className = 'dayOverlay';

            $(overlay).hide();

            daynum.style = daynumstyle;
            daynum.textContent = '{0}'.format(cndx - sndx + 1);

            td.overlay = overlay;
            
            td.year = year;
            td.month = month;
            td.day = cndx - sndx + 1;
            td.grp = group;

            td.dayndx = cndx;
            
            td.editbox = editbox;
            td.daynum = daynum;
            td.lockeduntil = undefined;
            td.tryingtolock = false;
            td.plugin = this;
            td.dirty = false;

            daynum.className = 'plugCalendar dayNumSpan';
            editbox.className = 'dayEditBox';
            editbox.rows = '6';
            editbox.td = td;
            editbox.buffer = [];
            
            // A work in progress...
            //editbox.tooltip = EnhancedTooltip(editbox);

            editbox.changehandler = function () {
                /*
                if (!this.td.lockedbyus || (this.td.lockeduntil != undefined && this.td.lockeduntil < new Date())) {
                    //event.cancelBubble = true;
                    //event.returnValue = false;
                    this.tryLock();
                    // This fixes issues where backspace will fire and we can
                    // not cancel it, but we can revert its changes.
                    if (this.lastknowndata != undefined) {
                        this.value = this.lastknowndata;
                    }
                    return false;
                }
                */

                // The update is very CPU intensive when it is done for every
                // change, therefore, it will only be updated once per the time
                // interval specified below.
                if (!this.td.plugin.hours_totals_update_queued) {
                    var self = this;
                    this.td.plugin.hours_totals_update_queued = true;
                    console.log('queued update');
                    setTimeout(function () {
                        self.td.plugin.hours_totals_update_queued = false;
                        self.td.plugin.modules_call_event('data_change_delayed_tick');
                    }, 3000);
                }

                /*
                this.lastknowndata = this.value;
                this.td.dirty = true;
                this.td.lastmodtime = new Date();
                this.td.className = 'dayCell Dirty';
                */
                return true;                
            }

            editbox.oninput = function () {
                this.changehandler();
            };

            $(editbox).change(function () {
                this.changehandler();
            });

            $(editbox).keypress(function () {
                this.changehandler();
            });

            $(editbox).keyup(function (event) {
                return this.changehandler();
            });            

            $(editbox).keydown(function (event) {
                return this.changehandler();
            });

            if (false) {
                editbox.onclick = function (event) {
                    // Set as not locked if lockeduntil time has expired.
                    if (this.td.lockeduntil != undefined && this.td.lockeduntil < new Date()) {
                        // This will also unlock if someone else had it locked, but it
                        // does not actually unlock it. It just causes us to try to acquire
                        // a lock again, and hopefully succeed in doing so.
                        this.td.lockeduntil = undefined;
                    }

                    // We need to try to lock it.
                    if (this.td.lockeduntil == undefined || !this.td.lockedbyus) {
                        this.tryLock();
                        event.returnValue = false;
                        event.cancelBubble = true;
                        return false;
                    }
                }                
            }

            editbox.onmouseover = function (event) {
                if (this.td.__namedlockedby == undefined) {
                    this.td.plugin.makeTooltipSummaryForDayEditBox(
                        this.td.plugin.cur_year, this.td.plugin.cur_month,
                        this.td.day, this
                    );
                }
            }

            editbox.tryLock = function () {
                // Only try if it has not already been locked.
                if (!this.td.tryingtolock) {
                    // Alert the user that the day is being locked.
                    this.td.className = 'dayCell Locking';
                    // Start the locking process.
                    this.td.tryingtolock = true;
                    var __element = this;
                    this.td.plugin.tryLock(group, year, month, this.td.day, 
                        function (code, lockeduntil, bypid, freshtext) {
                        __element.td.tryingtolock = false;
                        __element.td.lockeduntil = lockeduntil;
                        __element.value = freshtext;
                        __element.td.plugin.updateHourTotals();
                        if (code) {
                            // It has been locked by ourself.
                            __element.td.lockedbyus = true;
                            __element.td.className = 'dayCell LockedByMe';
                            __element.td.lockeduntil = lockeduntil;
                            __element.td.__namedlockedby = undefined;
                        } else {
                            // It is already locked by someone else.
                            __element.td.lockedbyus = false;
                            __element.td.className = 'dayCell LockedByOther';
                            // Let us try to get the name of this person.
                            if (bypid == -2) {
                                __element.td.className = 'dayCell NoLockingPermission';
                                __element.td.__namelockedby = 'nobody';
                                $(__element.td.overlay).show();
                            } else {
                                xemo.core.getPersonnelNamesFromIDs(
                                    __element.td.plugin.tk.getAuthHash(),
                                    [bypid],
                                    function (success, result) {
                                        var name = result.mapping[bypid] || '[error resolving name]';
                                        __element.td.__namedlockedby = name;
                                        __element.title = 'Locked For Edit By:\n' + name.toUpperCase();
                                        $(__element.td.overlay).show();
                                    }
                                );
                            }
                        }
                    });
                }                
            }

            cells.push(td);
            ++cndx;
        }
    }

    this.tryLock = function (grp, year, month, day, cb) {
        // The delta specifies the number of seconds into the future. The SQL backend shall handle
        // the actual times to prevent us from having to deal with time zones and rules. At this
        // current time the backend v1api.py actually defers it onto SQL internally.
        xemo.core.sop({
            key:       this.tk.getAuthHash(),
            year:      year,
            month:     month,
            day:       day,
            grp:       grp,
            delta:     60 * 3,
            op:        'daylock',
        }, function (data) {
            var code = data.result.code;
            var freshtext = data.result.freshtext;

            var lockeduntil = new Date();
            lockeduntil.setTime(lockeduntil.getTime() + 1000 * 60 * 2.5);
            if (code == 'accepted') {
                cb(true, lockeduntil, data.result.pid, freshtext);
            } else {
                cb(false, undefined, data.result.pid, freshtext);
            }
        });
    }

    var notesframe = this.notesframe;

    this.hours_totals_update_queued = false;

    this.makeTooltipSummaryForDayEditBox = function (year, month, day, dayeb) {
        var lines = dayeb.value.split('\n');
        var shifts = [];
        var txt = [];
        
        xemo.core.textcalendar.parseLinesIntoShifts(lines, function (name, start, end) {
            var shift = xemo.core.textcalendar.makeRoughShift(year, month, day, name, start, end);
            shifts.push(shift); 
        });

        xemo.core.textcalendar.refineRoughShifts(shifts);

        for (var x = 0; x < shifts.length; ++x) {
            var delta = (shifts[x].end - shifts[x].start) / 1000.0 / 60.0 / 60.0;
            txt.push('{0}: {1} hours'.format(shifts[x].name.toUpperCase(), delta));
        }

        dayeb.title = txt.join('\n');
    }

    var tk = this.tk;
    var plugin = this;

    plugin.cur_last = null;
    plugin.cur_month = null;
    plugin.cur_year = null;

    this.get_year = function () {
        return year;
    };

    this.get_month = function () {
        return month;
    };

    this.get_group = function () {
        return group;
    };

    this.calframe.refresh = function () {
        var todate = new Date(year, month - 1, 1);
        todate.setMonth(todate.getMonth() + 1);
        xemo.core.sop({
            key:        tk.getAuthHash(),
            op:         'calendar.range.read_with_last',
            from_year:  year,
            from_month: month,
            from_day:   1,
            to_year:    todate.getFullYear(),
            to_month:   todate.getMonth() + 1,
            to_day:     1,
            grp:        group
        }, function (data) {
            tk.waitShow('Fetching calendar data from the server.');
            try {
                var result = data.result.days;
                var last = data.result.last;

                // Store the current hash since it is important in order
                // to determine if the schedule has changed, before we try
                // to save our changes.
                plugin.cur_last = last;
                plugin.cur_month = month;
                plugin.cur_year = year;

                for (var x = 0; x < result.length; ++x) {
                    var record = {
                        year: result[x][0],
                        month: result[x][1],
                        day: result[x][2],
                        text: result[x][3]
                    };

                    cells[parseInt(record.day) - 1].editbox.value = record.text.split('\x06').join('\n');
                }

                plugin.modules_call_event('data_change_delayed_tick');
            } catch (err) {
                tk.waitError(err);
            }
            tk.waitHide();
        });
    }

    if (true) {
        $(this.controlframe).empty();

        var savebtn = document.createElement('input');
        savebtn.type = 'submit';
        savebtn.value = 'Save';

        var codeinput = document.createElement('input');

        $(this.controlframe).append(savebtn);
        $(this.controlframe).append('Code:');
        $(this.controlframe).append(codeinput);

        savebtn.onclick = function () {
            var days = [];
            for (var x = 0; x < cells.length; ++x) {
                days.push(cells[x].editbox.value);
            }
            xemo.core.sopv3({
                key:        tk.getAuthHash(),
                op:         'calendar.month.write_with_last_check',
                last:       plugin.cur_last,
                year:       plugin.cur_year,
                month:      plugin.cur_month,
                days:       days,
                code:       codeinput.value,
                grp:        group
            }, function (data) {
                tk.waitHide();
                alert('The save was successful.');
                location.reload();
            }, function (error) {
                alert('The save request was rejected by the server with the reason: ' + error);
                location.reload();
            }, function (error) {
                alert('There was a problem communicating with the server. Check your Internet connection, and contact someone.')
            });
        };
    }

    this.calframe.refresh();
}

xemo.plugins.Calendar.prototype.init = function () {
}

xemo.plugins.Calendar.prototype.onshow = function () {
    var cd = new Date();
    var params = this.tk.getURLParameters();
    // Just default to the driver plugin if nothing is specified.
    var initialgroup = params.plug_calendar_group || 'driver';
    this.generate(cd.getFullYear(), cd.getMonth() + 1, initialgroup);
}

xemo.plugins.Calendar.prototype.onhide = function () {
}

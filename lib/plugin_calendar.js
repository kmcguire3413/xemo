xemo.plugins.Calendar = function (tk, frame) {
    this.name = 'Console';
    this.prefix = tk.prefix + 'console__';
    this.frame = frame;
    this.tk = tk;
    $(this.frame).empty();

    var params = this.tk.getURLParameters();

    this.calframe = document.createElement('table');

    this.calframe.tk = tk;

    $(this.frame).append(this.calframe);    

    if ('no_menu' in params) {
        var fulluilink = document.createElement('a');
        fulluilink.textContent = '[Full Interface]';
        fulluilink.href = 'index.html?passhash=' + encodeURI(params.passhash);

        $(this.frame).append(fulluilink);
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

                        var xurl = 'v1api.py?key=' + plugin.tk.getAuthHash() + '&op=daywrite&year='
                         + cell.year + '&month=' + cell.month + '&day=' + cell.day + '&grp=' + cell.grp + '&txt=';
                        xurl = xurl + encodeURI(cell.editbox.value);
                        $.get(xurl, function (data) {
                            cell.className = 'dayCell Ready';
                            cell.saving = false;
                        }).fail(function () {
                            // The save failed. Make sure it stays marked as dirty.
                            cell.dirty = true;
                            cell.saving = false;
                        });
                    }
                }
            }
        }

        setTimeout(plugin.servicetask, 250);
    };

    setTimeout(this.servicetask, 250);
    return this;
}

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

xemo.plugins.Calendar.prototype.generate = function (year, month, group) {
    var titlecell = document.createElement('td');
    var lnknext = document.createElement('a');
    var lnkprev = document.createElement('a');

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

    $(titlecell).append(lnkprev, titletxt, lnknext);

    titlecell.colSpan = '7';

    var sndx = (new Date(year, month - 1, 1)).getDay();
    var daycount = (new Date(year, month, -1)).getDate();
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
        td.style = 'font-size: 1em; text-transform: uppercase; text-align: center; border: 1px solid Gray;';
        td.textContent = daynames[x];
        $(tr).append(td);
    }

    $(this.calframe).append(tr);
    this.calframe.className = 'plugCalendar';

    var cells = [];
    this.cells = cells;

    for (var y = 0; y < 5; ++y) {
        var tr = document.createElement('tr');
        $(this.calframe).append(tr);
        for (var x = 0; x < 7; ++x) {
            var td = document.createElement('td');

            td.className = 'dayCell Ready';

            $(tr).append(td);

            if (cndx > lndx) {
                ++cndx;
                continue;
            }

            if (cndx < sndx) {
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

            daynum.style = 'padding-left: 90%;';
            editbox.className = 'dayEditBox';
            editbox.rows = '6';
            editbox.td = td;
            editbox.buffer = [];
            
            // A work in progress.
            //editbox.tooltip = EnhancedTooltip(editbox);

            editbox.onkeypress = function (event) {
                event = event || window.event;
                if (!this.td.lockedbyus || (this.td.lockeduntil != undefined && this.td.lockeduntil < new Date())) {
                    event.cancelBubble = true;
                    event.returnValue = false;
                    this.tryLock();
                    return false;
                }
                this.td.dirty = true;
                this.td.lastmodtime = new Date();
                this.td.className = 'dayCell Dirty';
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
                        function (code, lockeduntil, bypid) {
                        __element.td.tryingtolock = false;
                        __element.td.lockeduntil = lockeduntil;
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
                            xemo.core.getPersonnelNamesFromIDs(
                                __element.td.plugin.tk.getAuthHash(),
                                [bypid],
                                function (success, result) {
                                    var name = result.mapping[bypid] || '[error resolving name]';
                                    __element.td.__namedlockedby = name;
                                    __element.title = 'Locked For Edit By:\n' + name;
                                    $(__element.td.overlay).show();
                                }
                            );
                        }
                    });
                }                
            }

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

            cells.push(td);
            ++cndx;
        }
    }

    this.tryLock = function (grp, year, month, day, cb) {
        // The delta specifies the number of seconds into the future. The SQL backend shall handle
        // the actual times to prevent us from having to deal with time zones and rules. At this
        // current time the backend v1api.py actually defers it onto SQL internally.
        $.get('v1api.py?key={0}&op=daylock&year={1}&month={2}&day={3}&grp={4}&delta={5}'.format(
            this.tk.getAuthHash(), year, month, day, grp, 60 * 3
        ), function (data) {
            var result = $.parseJSON(data)['result']; 
            var code = result.code;

            var lockeduntil = new Date();
            lockeduntil.setTime(lockeduntil.getTime() + 1000 * 60 * 2.5);
            if (code == 'accepted') {
                cb(true, lockeduntil, result.pid);
            } else {
                cb(false, undefined, result.pid);
            }
        });
    }

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
            txt.push('{0}: {1} hours'.format(shifts[x].name, delta));
        }

        dayeb.title = txt.join('\n');
    }

    this.calframe.refresh = function () {
        $.get('v1api.py?key={0}&op=readcalendar&from_year={1}&from_month={2}&from_day={3}&to_year={4}&to_month={5}&to_day={6}&grp={7}'.format(
            this.tk.getAuthHash(), year, month, 1, year, month + 1, 1, group
        ), function (data) {
            var data = $.parseJSON(data);
            var result = data['result'];

            for (var x = 0; x < result.length; ++x) {
                var record = {
                    year: result[x][0],
                    month: result[x][1],
                    day: result[x][2],
                    text: result[x][3]
                };

                cells[parseInt(record.day) - 1].editbox.value = record.text.split('\x06').join('\n');
            }
        });
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

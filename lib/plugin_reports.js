xemo.plugins.Reports = function (tk, frame) {
    this.name = 'Reports';
    this.frame = frame;
    this.tk = tk;
    $(this.frame).empty();
    return this;
}

xemo.plugins.Reports.prototype.init = function () {
    this.mods = {
        'DayListWithBars': {
            'constructor':         plugin_Reports_mod_DayListWithBars,
            'displayName':         'Day List With Bars',
        },
        'SoniaFormat': {
            'constructor':         plugin_Reports_mod_SoniaFormat,
            'displayName':         'Sonia Format', 
        },
        'Timesheet': {
            'constructor':         plugin_Reports_mod_Timesheet,
            'displayName':         'Sonia Timesheet',
        }
    };

    this.menuframe = document.createElement('div');
    this.modframe = document.createElement('div');

    this.modframe.style.overflow = 'hidden';

    $(this.frame).append(this.menuframe, '<hr/>', this.modframe);

    this.grpselect = document.createElement('select');
    $(this.grpselect).append('<option value="driver">Driver</option>');
    $(this.grpselect).append('<option value="medic">Medic</option>');

    this.modselect = document.createElement('select');

    // Create the menu of modules that can be executed.
    for (var k in this.mods) {
        var modop = document.createElement('option');
        modop.value = k;
        modop.textContent = this.mods[k].displayName;
        $(this.modselect).append(modop);
    }

    this.modselect.plug = this;
    this.modselect.onchange = function () {
        if (this.master == undefined) {
            return;
        }
        this.plug.doModule(this.value);
    }

    this.startrange = document.createElement('input');
    this.endrange = document.createElement('input');
    this.computebtn = document.createElement('input');

    function chk_vld_date(k) {
        if (isNaN(new Date(this.value))) {
            this.className = 'badinput';
            this.__disp.textContent = 'The date entered is not recognized.';
            this.__isvalid = false;
            this.__parent.computebtn.disabled = true;
        } else {
            this.className = 'goodinput';
            this.__disp.textContent = new Date(this.value);
            this.__isvalid = true;
            if (this.__parent.startrange.__isvalid && this.__parent.endrange.__isvalid) {
                var s = new Date(this.__parent.startrange.value);
                var e = new Date(this.__parent.endrange.value);
                if (e > s && e != s) {
                    this.__parent.computebtn.disabled = false;
                    this.__parent.computebtnstatus.textContent = 'The range is valid. You may compute the data for the reports.';
                    return;
                }

                this.__parent.computebtnstatus.textContent = 'One or both of the dates are invalid.';
                
                if (s > e) {
                    this.__parent.computebtnstatus.textContent = 'Error: The start date is greater than the end date.';
                }

                if (s.getTime() == e.getTime()) {
                    this.__parent.computebtnstatus.textContent = 'Error: The start date is the same as the end date.';   
                }
            }
        }
    }

    this.computebtn.disabled = true;

    this.startrange.className = this.endrange.className = 'badinput';

    this.startrange.onkeyup = this.startrange.onpaste = chk_vld_date;
    this.endrange.onkeyup = this.endrange.onpaste = chk_vld_date;

    this.startrange.__isvalid = this.endrange.__isvalid = false;
    this.startrange.__parent = this.endrange.__parent = this;

    this.computebtn.value = "Compute";
    this.computebtn.type = "submit";

    this.startrangedisp = document.createElement('span');
    this.endrangedisp = document.createElement('span');
    this.computebtnstatus = document.createElement('span');

    this.startrangedisp.textContent = this.endrangedisp.textContent = 'Enter a valid date.';

    this.startrange.__disp = this.startrangedisp;
    this.endrange.__disp = this.endrangedisp;

    $(this.menuframe).append(
        ' Report Module: ',
        this.modselect, 
        '<br/>Start Range: ',
        this.startrange, ' ', this.startrangedisp,
        '<br/>End Range: ',
        this.endrange, ' ', this.endrangedisp,
        '<br/>',
        this.computebtn, ' ', this.computebtnstatus
    );

    this.computebtn.plug = this;

    this.doModule = function (mod, params) {
        if (this.curmod != undefined && this.curmod != null) {
            this.curmod.unload();
            this.curmod = null;
        }

        if (mod == undefined) {
            mod = this.modselect.value;
        }

        this.curmod = new this.mods[mod].constructor(this, this.modframe, params || {});
    }

    this.computebtn.onclick = function () {
        // A hackish way to adapt old code for the moment. I expect
        // the change this to a more proper system. The __log is a
        // global function called by the core code.
        var sg__plug = this.plug;
        __log = function (level, msg) {
            sg__plug.tk.log(msg);
        };

        var config = {}
        config.incpayper12hrshift = 25.0;
        config.incpayperhour = 2.0;
        config.transportpay = 25.0;
        config.numtransportswaived = 1;
        config.fulltimehours = 40.0;
        config.parttimehours = 20.0;

        var from = new Date(this.plug.startrange.value);
        var to = new Date(this.plug.endrange.value);

        plugin_pay_bootstrap(
            this.plug.tk.getAuthHash(), 
            from.getFullYear(), from.getMonth() + 1, from.getDate(), from.getHours(), 
            to.getFullYear(), to.getMonth() + 1, to.getDate(), to.getHours(), 
            this.plug.grpselect.value,
            config,
            function (master) {
                sg__plug.tk.log(JSON.stringify(master, null, 4));
                sg__plug.master = master;
                sg__plug.doModule();
            }
        );        
    }
    
    //for (var k in this.mods) {
    //    this.mods[k].object = new this.mods[k].object(this, this.modframe);
    //}
}

/*
    A module is created on demand unlike a plugin which may run constantly
    and is created on boot. When a module is no longer being used it is
    expected to free all resources. A module may also have parameters passed
    to it which alter what it displays.

    Day List With Bars
    Pay Period List
    Monthly Incentive List
    Personnel Detail
*/

function plugin_Reports_mod_Timesheet(reports, frame, params) {
    this.reports = reports;
    this.frame = frame;
    this.params = params;

    var shifts = reports.master.shifts;
    var from = reports.master.from;
    var to = reports.master.to;
    var local = [];

    for (var i = 0; i < shifts.length; ++i) {
        var shift = shifts[i].excludeafter(to);
        if (shift == null) {
            continue;
        }
        shift = shift.excludeafter(from, true);
        if (shift == null) {
            continue;
        }

        var tmp = shift.end.clone();
        tmp.setHours(0);
        tmp.setMinutes(0);
        var result = shift.splitby(tmp);
        if (result != null) {
            local.push(result[0]);
            local.push(result[1]);
        } else {
            local.push(shift);
        }
    }   

    var dmonth = {}; 

    for (var i = 0; i < shifts.length; ++i) {
        var shift = shifts[i];
        var year = shift.start.getFullYear();
        var month = shift.start.getMonth() + 1;
        var day = shift.start.getDate();

        //if (shift.start.getHours() < 6) {
        //    --day;
        //}

        // Normalize the date..
        //var normdate = new Date(year, month - 1, day);

        var monthid = shift.payperiod14[0];

        var hrs = (shift.end - shift.start) / 1000.0 / 60.0 / 60.0;

        if (shift.allocatedfor == null) {
            continue;
        }

        var aid;
        if (!shift.allocatedfor.id) {
            if (shift.allocatedfor.system == 'standard incentive') {
                aid = 'standard incentive';
            } else {
                continue;
            }
        } else {
            aid = shift.allocatedfor.id;
        }

        var ndx = Math.floor((shift.start - shift.payperiod14[0]) / 1000.0 / 60.0 / 60.0 / 24.0);

        if (shift.name != 'kevin') {
            continue;
        }

        //alert('shift.start:{0}\nshift.payperiod14[0]:{1}\nndx:{2}'.format(
        //    shift.start, shift.payperiod14[0], ndx
        //));

        dmonth[monthid] = dmonth[monthid] || { ppdate: monthid, data: {} };
        dmonth[monthid].data[shift.name] = dmonth[monthid].data[shift.name] || []
        dmonth[monthid].data[shift.name][ndx] = dmonth[monthid].data[shift.name][ndx] || {};
        if (dmonth[monthid].data[shift.name][ndx][aid] == undefined) {
            dmonth[monthid].data[shift.name][ndx][aid] = 0;
        }
        dmonth[monthid].data[shift.name][ndx][aid] += hrs;
    }

    function generate_timesheet(ppstart, name, data) {
        var mw = window.open('', '', '');

        mw.document.body.style = 'font-family: "Century Gothic"; font-size: 9pt; line-height: 170%;';

        var margincont = document.createElement('div');

        margincont.style = 'margin: 0.5in .747in 0.5in .747in';

        var title = document.createElement('div');
        title.style = 'position: absolute; left: 4.14in; top: 0.75in; color: gray; font-size: 22pt;'
        $(title).append('<b>Biweekly Time Sheet</b>');
        var subtitle = document.createElement('div');
        subtitle.style = 'left: 1.01in; top: 1.26in; position: absolute; font-size: 22pt;';
        $(subtitle).append('<b>Eclectic EMS</b>');
        var address = document.createElement('div');
        address.style = 'position: absolute; left: 1in; top: 1.79in;';
        $(address).append('PO BOX 240430<br/>Eclectic, AL<br/>36024<br/>');
        var pprangehdr = document.createElement('div');
        pprangehdr.style = 'position: absolute; left: 4.11in; top: 1.79in;';
        $(pprangehdr).append('Pay period start date:<br/>Pay period end date:');
        var eposition = document.createElement('div');
        eposition.style = 'position: absolute; left: 4.11in; top: 2.6in;';
        eposition.textContent = 'Employee Position:    DRIVER';

        var sigarea = document.createElement('div');
        sigarea.style = 'position: absolute; left: 2.72in; top: 8.16in;';

        var svgsigline = '<svg height="3" width="4.5in"><line x1="0" y1="0" x2="4.5in" y2="0" style="stroke: rgb(0, 0, 0); stroke-width: 2;" /></svg><br/>';
        
        $(sigarea).append(
            '<br/><br/>',
            svgsigline, 
            '<br/>Employee Signature<br/><br/>',
            svgsigline,
            '<br/>EMS Director Signature<br/><br/>',
            svgsigline,
            '<br/>Mayor<br/><br/>'
        );

        var table = document.createElement('table');
        table.style = 'position: absolute; left: 1in; top: 3.2in; width: 6.5in; border: 1px solid gray';
        $(table).append('<thead style="cell-padding: 5px;"> \
                         <td style="width: .86in;">Day</td> \
                         <td style="width: .65in;">Date</td> \
                         <td style="width: .73in;">Regular Hours</td> \
                         <td style="width: .67in;">Efficiency Hours $6.00</td> \
                         <td style="width: .8in;">Volunteer $2</td> \
                         <td style="width: .57in;">Sick</td> \
                         <td style="width: .68in;">Vacation</td> \
                         <td style="wdith: .72in;">Holiday</td> \
                         <td style="width: .64in;">Total</td> \
                        </thead> \
        ');

        $(margincont).append(title, subtitle, address, table, pprangehdr, eposition, sigarea);
        $(mw.document.body).append(margincont);

        $(mw.document.head).append('<style>table { border: 1px solid gray; border-collapse: collapse; font-family: "Century Gothic"; font-size: 9pt; } td { border: 1px solid gray; padding: 5px; }</style>');

        var daynames = [
            'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
        ]; 

        var thrs8x5 = 0;
        var thrs4x6 = 0;
        var thrsinc = 0;       

        for (var x = 0; x < data.length; ++x) {
            var hrs8x5;
            var hrs4x6;
            var hrsinc;
            if (data[x] == undefined) {
                hrs8x5 = 0;
                hrs4x6 = 0;
                hrsinc = 0;
            } else {
                hrs8x5 = data[x]['8x5 PAY'] || 0;
                hrs4x6 = data[x]['4x6 PAY'] || 0;
                hrsinc = data[x]['standard incentive'] || 0;
                thrs8x5 += hrs8x5;
                thrs4x6 += hrs4x6;
                thrsinc += hrsinc;
            }

            var d = new Date(ppstart.getTime() + (x * 24.0 * 60.0 * 60.0 * 1000.0));

            $(table).append('<tr>\
                <td><b>{0}</b></td> \
                <td>{1}</td> \
                <td>{2}</td> \
                <td>{3}</td> \
                <td>{4}</td> \
                <td></td> \
                <td></td> \
                <td></td> \
                <td>{5}</td> \
            </tr>'.format(
                daynames[d.getDay()],
                (d.getMonth() + 1) + '/' + d.getDate(),
                hrs8x5,
                hrs4x6,
                hrsinc,
                hrs8x5 + hrs4x6 + hrsinc
            ));
        }

        $(table).append('<tr><td></td><td></td><td><b>{0}</b></td><td><b>{1}</b></td><td><b>{2}</b></td><td></td><td></td><td></td><td><b>{3}</b></td></tr>'.format(
            thrs8x5, thrs4x6, thrsinc, thrs8x5 + thrs4x6 + thrsinc
        ));

    }

    for (var monthid in dmonth) {
        var tmp = monthid.split('-');
        var year = tmp[0];
        var month = tmp[1]; 
        var ppdate = dmonth[monthid].ppdate;
        for (var name in dmonth[monthid].data) {
            if (dmonth[monthid].data[name].length == 14) {
                generate_timesheet(ppdate, name, dmonth[monthid].data[name]);
            }
        }
    }
}

plugin_Reports_mod_Timesheet.prototype.unload = function () {
    $(this.frame).empty();
}


/*
    PLUGIN REPORTS MODULE SONIA FORMAT
*/
function plugin_Reports_mod_SoniaFormat(reports, frame, params) {
    this.reports = reports;
    this.frame = frame;
    this.params = params;

    var shifts = reports.master.shifts;
    var from = reports.master.from;
    var to = reports.master.to;
    var local = [];

    for (var i = 0; i < shifts.length; ++i) {
        var shift = shifts[i].excludeafter(to);
        if (shift == null) {
            continue;
        }
        shift = shift.excludeafter(from, true);
        if (shift == null) {
            continue;
        }

        var tmp = shift.end.clone();
        tmp.setHours(0);
        tmp.setMinutes(0);
        var result = shift.splitby(tmp);
        if (result != null) {
            local.push(result[0]);
            local.push(result[1]);
        } else {
            local.push(shift);
        }
    }   

    var dmonth = {}; 

    for (var i = 0; i < shifts.length; ++i) {
        var shift = shifts[i];
        var year = shift.start.getFullYear();
        var month = shift.start.getMonth() + 1;
        var day = shift.start.getDate();

        if (shift.start.getHours() < 6) {
            --day;
        }

        // Normalize the date..
        var normdate = new Date(year, month - 1, day);
        var year = normdate.getFullYear();
        var month = normdate.getMonth() + 1;
        var day = normdate.getDate();

        var monthid = year + '-' + month;

        var hrs = (shift.end - shift.start) / 1000.0 / 60.0 / 60.0;

        if (shift.allocatedfor == null) {
            continue;
        }

        if (shift.allocatedfor.system != 'standard incentive') {
            continue;
        }

        --day;

        dmonth[monthid] = dmonth[monthid] || [];
        dmonth[monthid][day] = dmonth[monthid][day] || {}
        dmonth[monthid][day][shift.name] = dmonth[monthid][day][shift.name] || 0;
        dmonth[monthid][day][shift.name] += hrs;
    }

    for (var k in dmonth) {
        $(this.frame).append('<b>' + k + '</b>');
        var tbl = document.createElement('table');
        tbl.className = 'standard';
        $(tbl).append('<thead><td>Date</td><td>Name</td><td>Hours</td><td>Name</td><td>Hours</td><td>Name</td><td>Hours</td><td>Name</td><td>Hours</td><td>Total Hours</td></thead>');
        for (var x = 0; x < dmonth[k].length; ++x) {
            var row = [];
            var total = 0;
            if (dmonth[k][x] != undefined) {
                for (var name in dmonth[k][x]) {
                    row.push('<td>{0}</td><td>{1}</td>'.format(name, dmonth[k][x][name]));
                    total += dmonth[k][x][name];
                }
            }
            while (row.length < 4) {
                row.push('<td></td><td></td>');
            }
            row = row.join('');
            $(tbl).append('<tr><td>' + (x + 1) + '</td>' + row + '<td>' + total + '</td></tr>');
        }
        $(this.frame).append(tbl);
    }
}

plugin_Reports_mod_SoniaFormat.prototype.unload = function () {
    $(this.frame).empty();
}

/*
    This module will display a series of rows vertically that represent each
    individual day. Each row represents 24 hours and each personnel who worked
    time is placed on the row in order with a colored bar representing the amount
    of time they worked. The bar is also colored according to rules.

    The default coloring is:
        yellow - incentive only person
        red- incentive time for person with other pay systems
        green - standard hours for the person
        blue - non-standard hours for the person
*/
function plugin_Reports_mod_DayListWithBars(reports, frame, params) {
    this.reports = reports;
    this.frame = frame;

    var foundnonnull = false

    var lastday = null;
    var row = [];
    var lasthour = 0;
    var curdate = undefined;
    var lastpp = null;

    var local = [];
    var shifts = reports.master.shifts;
    var from = reports.master.from;
    var to = reports.master.to;

    for (var i = 0; i < shifts.length; ++i) {
        var shift = shifts[i].excludeafter(to);
        if (shift == null) {
            continue;
        }
        shift = shift.excludeafter(from, true);
        if (shift == null) {
            continue;
        }

        var tmp = shift.end.clone();
        tmp.setHours(0);
        tmp.setMinutes(0);
        var result = shift.splitby(tmp);
        if (result != null) {
            local.push(result[0]);
            local.push(result[1]);
        } else {
            local.push(shift);
        }
    }    

    var tbl = document.createElement('table');

    $(this.frame).empty();

    var modes = [
        ['typeoftime', 'Color By Type Of Time'],
        ['calls', 'Color By Call Count'],
    ];

    var colormode = document.createElement('select');
    for (var i = 0; i < modes.length; ++i) {
        var tmp = '';
        if (params.colormode == modes[i][0]) {
            tmp = 'selected="selected"';
        }
        $(colormode).append('<option {2} value="{0}">{1}</option>'.format(modes[i][0], modes[i][1], tmp));
    }

    params.colormode = params.colormode || 'typeoftime';

    colormode.onchange = function () {
        reports.doModule('DayListWithBars', {
            colormode:      this.value,
        });
    }

    $(this.frame).append(colormode, '<hr/>');

    var tw = 7.5;

    var mw = window.open('', '', '');

    tbl.className = 'condensed';

    var cont = document.createElement('div');

    cont.style.width = "5000px";

    $(mw.document.head).append('<link rel="stylesheet" type="text/css" href="http://kmcg3413.net/fcal/default.css"/>');
    //$(mw.document.head).append('<link rel="stylesheet" type="text/css" href="http://kmcg3413.net/fcal/default.css"/>');
    $(cont).append(tbl);
    $(mw.document.body).append(cont);

    setTimeout(function () {
        cont.style.width = ($(tbl).width() + 100) + 'px';
    }, 3000);

    //$(this.frame).append(tbl);
    for (var i = 0; i < local.length; ++i) {
        var shift = local[i];
        if (shift.allocatedfor != null) {
            foundnonnull = true;
        }

        if (!foundnonnull) {
            continue;
        }

        //__log(10, '<tr><td> {0} </td><td> {1} </td><td> {2} </td><td> {3} </td><td> {4} </td></tr>'.format(
        //    shift.payperiod[0].toISOString(), shift.start.toISOString(), shift.end.toISOString(), shift.name, shift.allocatedfor
        //));

        var bg;

        if (params.colormode == 'calls') {
            if (shift.info_incentive == undefined) {
                bg = '#999999';
            } else {
                var numcalls = shift.info_incentive.numcalls;
                var colortbl = [
                    '#999999',
                    '#99bb99',
                    '#99dd99',
                    '#99ff99',
                    '#99ffff',
                ];

                if (numcalls >= colortbl.length) {
                    bg = numcalls[colortbl.length - 1];
                } else {
                    bg = colortbl[numcalls];
                }
            }
        }

        if (params.colormode == 'typeoftime') {
            bg = '#cccccc';

            var allocatedfor = shift.allocatedfor || {};

            if (allocatedfor.system == 'hourly_withcap') {
                if (allocatedfor['non-standard-hours']) {
                    if (shift.allocatedfor.id == '4x6 PAY') {
                        bg = '#ff44ff';
                    } else {
                        bg = '#ccccff';
                    }
                } else {
                    if (shift.allocatedfor.id == '4x6 PAY') {
                        bg = '#ffccff';
                    } else {
                        bg = '#ccffcc';
                    }
                }
            }

            if (allocatedfor.system == 'standard incentive') {
                if (shift.info_incentive.per_payperiod_lock) {
                    bg = '#ff8888';
                } else {
                    bg = '#ffffcc';
                }
            }
        }

        if (lastday == null) {
            lastday = shift.start.getDate();
            curdate = [shift.start.getFullYear(), shift.start.getMonth() + 1, shift.start.getDate()];
        }

        if (shift.start.getDate() != lastday) {
            var dstr = '{0}-{1}-{2}'.format(curdate[0], curdate[1], curdate[2]);
            var curpp = Math.floor(shift.payperiod14[0].getTime() / 1000.0 / 60.0 / 60.0 / 24.0 / 7.0);
            var subpp;

            if ((shift.start - shift.payperiod14[0]) / 1000.0 / 60.0 / 60.0 / 24.0 >= 7.0) {
                subpp = 'B';
            } else {
                subpp = 'A';
            }

            if (lastpp == null) {
                lastpp = curpp;
            }

            if (lastpp != curpp) {
                $(tbl).append('<tr><td></td><td></td><td style="background-color: #cccccc;">PAY PERIOD {0}</td></tr>'.format(curpp));
                lastpp = curpp;
            }

            $(tbl).append('<tr><td>{0}</td><td>{1}</td><td>{2}</td></tr>'.format(
                subpp, dstr, row.join('')
            ));

            row = [];
            lastday = shift.start.getDate();
            curdate = [shift.start.getFullYear(), shift.start.getMonth() + 1, shift.start.getDate()];
            lasthour = 0;

        }

        function pushrowpart(hrs, bg, s, tooltip, fg) {
            if (fg == undefined) {
                fg = '#000000';
            }
            var w = (hrs / 24.0) * tw;
            row.push(
                '<span title="' + tooltip + '" style="color: ' + fg + '; float: left; width: ' + w + 'in; background-color: ' + bg + ';">' + s + '</span>'
            );            
        }

        var shift_start_hrmin = shift.start.getHours() + shift.start.getMinutes() / 60.0;

        if (shift_start_hrmin - lasthour > 0) {
            //alert('shift.start:{0} shift.name:{2} lasthour:{1}'.format(shift.start, lasthour, shift.name));
            var hrs = shift_start_hrmin - lasthour;
            pushrowpart(hrs, '#000000', hrs, '', '#dddddd');
        }

        lasthour = shift.end.getHours() + shift.end.getMinutes() / 60.0;

        var hrs = (shift.end - shift.start) / 1000.0 / 60.0 / 60.0;

        var tooltip = [];
        for (var k in shift.allocatedfor) {
            tooltip.push(k + ': ' + shift.allocatedfor[k]);
        }
        tooltip.push('hours: ' + (hrs));
        tooltip.push('start: ' + shift.start);
        tooltip.push('end: ' + shift.end);
        tooltip.push('name: ' + shift.name);
        tooltip.push('personnel-id: ' + shift.pid);

        pushrowpart(hrs, bg, shift.name + '(' + shift.start.getHours() + '-' + shift.end.getHours() + ')', tooltip.join('\n'));
    }

    return this;
}

plugin_Reports_mod_DayListWithBars.prototype.unload = function () {
    $(this.frame).empty();
}

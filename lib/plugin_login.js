function plugin_Console(tk, frame) {
    this.name = 'Console';
    this.prefix = tk.prefix + 'console__';
    this.frame = frame;
    $(this.frame).empty();

    this.buffer = [];

    this.log = document.createElement('pre');

    this.write('[console initialized]');

    $(this.frame).append('This component catches messages that are used to debug the system.');
    $(this.frame).append(this.log);    
    return this;
}

plugin_Console.prototype.init = function () {
    /*
        At the moment I do not have a dependency system and plugins
        expect that console is properly loaded. So I do all my work
        in the constructor, which is actually okay since I do not
        use the interface `tk`.
    */
}

plugin_Console.prototype.onshow = function () {
    // I had to do this to prevent the window from scrolling
    // as messages were added to the log. Now, they are only
    // rendered to screen when the plugin becomes visible.
    for (var x = 0; x < this.buffer.length; ++x) {
        $(this.log).append(this.buffer[x]);
    }
}

plugin_Console.prototype.onhide = function () {
    $(this.log).empty();
}

plugin_Console.prototype.write = function (msg) {
    this.buffer.push(msg + '<br/>');
}

function plugin_Calendar(tk, frame) {
    this.name = 'Calendar';
    this.frame = frame;
    this.tk = tk;
    $(this.frame).empty();
    return this;
}

plugin_Calendar.prototype.init = function () {
}

function plugin_Reports(tk, frame) {
    this.name = 'Reports';
    this.frame = frame;
    this.tk = tk;
    $(this.frame).empty();
    return this;
}

plugin_Reports.prototype.init = function () {
    this.mods = {
        'DayListWithBars': {
            'constructor':         plugin_Reports_mod_DayListWithBars,
            'displayName':         'Day List With Bars',
        },
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
    $(this.frame).append(tbl);
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

        var bg = '#cccccc';

        if (shift.allocatedfor == null) {
            shift.allocatedfor = '';
        }

        if (shift.allocatedfor.indexOf('NON-STANDARD-HOURS') > -1) {
            bg = '#ccccff';
        } else {
            if (shift.allocatedfor.indexOf('STANDARD-HOURS') > -1) {
                bg = '#ccffcc';
            }
        }

        if (shift.allocatedfor.indexOf('INCENTIVE') > -1) {
            if (shift.name == 'kevin') {
                bg = '#ffcccc';
            } else {
                bg = '#ffffcc';
            }
        }

        if (lastday == null) {
            lastday = shift.start.getDate();
            curdate = [shift.start.getFullYear(), shift.start.getMonth() + 1, shift.start.getDate()];
        }

        if (shift.start.getDate() != lastday) {
            var dstr = '{0}-{1}-{2}'.format(curdate[0], curdate[1], curdate[2]);
            $(tbl).append('<tr><td>' + dstr + '</td><td>' + row.join('') + '</td></tr>');
            row = [];
            lastday = shift.start.getDate();
            curdate = [shift.start.getFullYear(), shift.start.getMonth() + 1, shift.start.getDate()];
            lasthour = 0;
        }

        var tw = 1024;

        function pushrowpart(hrs, bg, s, fg) {
            if (fg == undefined) {
                fg = '#000000';
            }
            var w = Math.round((hrs / 24.0) * tw);
            row.push(
                '<span style="color: ' + fg + '; float: left; width: ' + w + 'px; background-color: ' + bg + ';">' + s + '</span>'
            );            
        }

        var shift_start_hrmin = shift.start.getHours() + shift.start.getMinutes() / 60.0;

        if (shift_start_hrmin - lasthour > 0.2) {
            //alert('shift.start:{0} shift.name:{2} lasthour:{1}'.format(shift.start, lasthour, shift.name));
            var hrs = shift_start_hrmin - lasthour;
            pushrowpart(hrs, '#000000', hrs, '#dddddd');
        }

        lasthour = shift.end.getHours() + shift.end.getMinutes() / 60.0;

        var hrs = (shift.end - shift.start) / 1000.0 / 60.0 / 60.0;

        pushrowpart(hrs, bg, shift.name + '(' + shift.start.getHours() + '-' + shift.end.getHours() + ')');
    }

    $(this.frame).append('</table>');

    return this;
}

plugin_Reports_mod_DayListWithBars.prototype.unload = function () {
    $(this.frame).empty();
}

function plugin_Login(tk, frame) {
    this.name = 'Login';
    this.frame = frame;
    this.tk = tk;
    $(this.frame).empty();
    return this;
}

plugin_Login.prototype.init = function () {
    this.prefix = this.tk.prefix + 'login__';
    $(this.frame).empty();
    var params = GetURLParameters();
    var username = params.username;
    var password = params.password;
    var passhash = params.passhash;

    this.tk.log('initialized');

    this.status = document.createElement('div');

    this.status.id = '{0}status'.format(this.prefix);

    $(this.frame).append(this.status);

    $(this.status).empty();
    $(this.status).append('Enter your login information to access the system.<br/><br/>');

    this.formcont = document.createElement('div');
    this.formlogout = document.createElement('div');
    $(this.formlogout).hide();

    this.username = document.createElement('input');
    this.password = document.createElement('input');
    this.userpwsubmit = document.createElement('input');

    this.userlogout = document.createElement('input');
    this.userlogout.type = 'submit';
    this.userlogout.value = 'Logout';
    this.userlogout.__loginobj = this;
    this.userlogout.onclick = function () {
        $(this.__loginobj.formcont).show();
        $(this.__loginobj.formlogout).hide();
        this.__loginobj.valid_username = undefined;
        this.__loginobj.valid_password = undefined;
        this.__loginobj.valid_passhash = undefined;
        window.location.href = 'index.html';
    }

    $(this.formlogout).append(this.userlogout);

    this.username.value = username || '';
    this.password.value = password || '';

    this.username.className = 'ui';
    this.password.className = 'ui';
    this.userpwsubmit.className = 'ui';

    this.userpwsubmit.type = 'submit';
    this.userpwsubmit.value = 'Login';

    this.userpwsubmit.__loginobj = this;
    this.userpwsubmit.onclick = function () {
        // We need to reload the page with the hash for the username and password.
        // This helps people bookmark the page and saves their username and password.
        var hash = CryptoJS.SHA512('{0}:{1}'.format(
            this.__loginobj.username.value, 
            this.__loginobj.password.value
        ));
        window.location.href = 'index.html?passhash=' + hash;
    }

    $(this.formcont).append('Username: ', this.username, ' Password: ', this.password, ' ', this.userpwsubmit);
    $(this.frame).append(this.formcont);
    $(this.frame).append(this.formlogout);

    /*
    $(this.frame).append('\
        Username: <input class="ui" id="{0}username" type="input" value="{1}"/> \
        Password: <input class="ui" id="{0}password" type="input" value="{2}"/> \
        <input class="ui" type="submit" value="Verify"/><br/> \
    '.format(this.prefix, username, password));
    */

    this.verify = function (hash, cb) {
        $.get('v1api.py?key={0}&op=verify'.format(hash), function (data) {
            var data = $.parseJSON(data);
            if (data['code'] == 'error') {
                cb(false, undefined, undefined);
                return;
            }
            cb(true, data['id'], data['username']);
        });
    }

    //alert(CryptoJS.SHA512('hello world'));
    this.doVerify = function (hash) {
        // Go ahead do the login verification process.
        this.formcont.disabled = true;
        $(this.status).empty();
        $(this.status).append('Please wait while your information is validated..<br/><br/>');
        var status = this.status;
        if (hash == undefined) {
            hash = CryptoJS.SHA512('{0}:{1}'.format(this.username.value, this.password.value));
        }
        var __obj = this;
        this.verify(hash, function (result, id, username) {
            $(status).empty();
            __obj.formcont.disabled = false;
            if (result) {
                $(status).append('You are successfully logged into the system.<br/><br/>');
                $(__obj.formcont).hide();
                $(__obj.formlogout).show();
                __obj.valid_username = __obj.username.value;
                __obj.valid_passhash = hash;
            } else {
                $(status).append('Your login has been rejected..<br/><br/>');
            }
        });
    };

    this.getAuthHash = function () {
        return this.valid_passhash;
    }

    if (username != undefined && password != undefined) {
        this.doVerify();
    }

    if (passhash != undefined) {
        this.doVerify(passhash);
    }
}
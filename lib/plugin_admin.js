xemo.plugins.Admin = function (tk, frame) {
    this.name = 'Administration';
    this.frame = frame;
    this.tk = tk;
    $(this.frame).empty();

    //this.frame.style.width = '400px';
    return this;
}

xemo.plugins.Admin.wizards = {};

xemo.plugins.Admin.prototype.init = function () {
    var selframe = document.createElement('div');
    // wizards 
        // I want to change something about a personnel.
        // I want to add a new personnel to the system.
        // I want to change a pay specification.
        // I want to add a new pay specification.
        // I want to add a new calendar.
        // I want to remove a calendar.
        // I want to add an event.
        // I want to view all events.
        // I want to view all personnel.
        // I want to add a new crew function.

    $(selframe).append(' \
        <div class="xemoPluginAdminDescription"> \
        This is the administration page. If you do not have write priviledges then \
        any modifcation will fail, however you can view the information. Select \
        from the following wizards in order to manage the system. \
        </div> \
        <hr/> \
    ');

    var dialogframe = document.createElement('div');

    var pframe = this.frame;
    var tk = this.tk;
    for (var k in xemo.plugins.Admin.wizards) {
        var wizard = xemo.plugins.Admin.wizards[k];
        var link = document.createElement('div');
        link.textContent = wizard.description;
        link.className = 'xemoPluginAdminWizardLink';
        link.wizard = wizard;
        link.onclick = function () {
            this.wizard.open( { tk: tk, pframe: dialogframe} );
        }
        $(selframe).append(link, '<br/>');
    }

    $(this.frame).empty();
    $(this.frame).append(selframe, dialogframe);
}

xemo.core.getAllPersonnel = function (key, cb) {
    xemo.core.sop({
        key:      key,
        op:       'paysystem.all.get',
        all:      true
    }, function (a) {
        xemo.core.sop({
            key:    key,
            op:     'personnel.all.get'
        }, function (b) {
            a = a.result;
            b = b.result;
            /*
                I changed the interface and needed to emulate
                this old operation. The operation was mostly
                redundant and added bloat to the server. So
                this uses the two calls to produce the same
                old data structure.
            */
            var out = {
                personnel:    {},
                payspecs:     {}  
            };

            out.personnel = b;
            for (var pid in out.personnel) {
                out.personnel[pid].paysystem = [];
            }

            for (var pid in a.mapping) {
                for (var x = 0; x < a.mapping[pid].length; ++x) {
                    var sys = a.mapping[pid][x];
                    if (!out.personnel[pid]) {
                        continue;
                    }
                    out.personnel[pid].paysystem.push({
                        sysid:    sys.sysid,
                        start:    sys.start,
                        end:      sys.end
                    });
                }
            }

            out.payspecs = a.systems;

            cb(out);
        });
    });
}

function absorbMethods(onto, from) {
    for (var k in from) {
        setMethod(onto, k, f, from[k]);
    }
}

function setMethod(onto, name, obj, method) {
    onto[name].method = function () {
        var args = [].slice.call(arguments);
        method.apply(obj, args);
    }
}

/*
    This contains custom HTML elements useful for displaying information
    specific to the system.
*/
xemo.core.html = {};

xemo.core.html.UserPaySystemSelector = function (payspecs, selected_sysid) {
    var frame = document.createElement('div');
    var sel = document.createElement('select');
    var desc = document.createElement('div');

    frame.className = 'xemoCoreHtmlUserPaySystemSelectorFrame';

    for (var sysid in payspecs) {
        var opt = document.createElement('option');
        opt.textContent = payspecs[sysid].sysname;
        opt.value = sysid;
        opt.className = 'xemoCoreHtmlUserPaySystemSelectorOption';
        if (sysid == selected_sysid) {
            opt.selected = true;
        }
        $(sel).append(opt);
    }

    desc.className = 'xemoCoreHtmlUserPaySystemSelectorDescription';

    sel.desc = desc;
    sel.onchange = function () {
        var s_sysid = parseInt(sel.value);
        for (var sysid in payspecs) {
            if (sysid == s_sysid) {
                this.desc.textContent = payspecs[sysid].desc;
            }
        }
    }

    frame.sel = sel;
    frame.desc = desc;

    frame.getSelectedSystemID = function () {
        return parseInt(this.sel.value);
    };

    sel.onchange();

    $(frame).append(sel, desc);

    return frame;
}

xemo.core.html.UserPayPeriodIDField = function () {
    var frame = document.createElement('div');
    var input = document.createElement('input');
    var humanreadable = document.createElement('span');

    frame.updateHumanReadable = xemo.core.html.UserPayPeriodIDField.updateHumanReadable;

    frame.humanreadable = humanreadable;
    frame.input = input;

    input.frame = frame;
    input.onchange = frame.updateHumanReadable;

    frame.frame = frame;

    $(frame).append(input);
    $(frame).append(humanreadable);

    frame.setValue = xemo.core.html.UserPayPeriodIDField.setValue;
    frame.getValue = xemo.core.html.UserPayPeriodIDField.getValue;
    return frame;
}

xemo.core.html.UserPayPeriodIDField.getValue = function () {
    return this.input.value;
}

xemo.core.html.UserPayPeriodIDField.updateHumanReadable = function () {
    // var ppid = Math.floor(cur_pp_start.getTime() / 1000.0 / 60.0 / 60.0 / 24.0 / 7.0);
    var ppid = parseInt(this.frame.input.value);
    var actualdate = new Date(ppid * 7 * 24 * 60 * 60 * 1000);
    this.frame.humanreadable.textContent = actualdate.shortString();
}

xemo.core.html.UserPayPeriodIDField.setValue = function (value) {
    this.input.value = value;
    this.updateHumanReadable();
}

xemo.core.commitPersonnel = function (key, tocommit) {
    xemo.core.sop({
        op:       'commitPersonnel',
        key:      key,
        tocommit: tocommit
    }, function (data) {
        alert('commitPersonnel: ' + data);
    });
}

xemo.plugins.Admin.dialogs = {
    /*
        This pushes a new dialog onto the stack. Any previous
        dialogs are simply hidden, and are not destroyed.

        _This happens when you wish to open the next dialog
        for a wizard for example._
    */
    NewDialog: function (state, myframe) {
        if (myframe == undefined) {
            var outerframe = document.createElement('div');
            myframe = document.createElement('div');
            var backbtn = document.createElement('input');
            backbtn.type = 'submit';
            backbtn.value = 'Back';
            backbtn.onclick = function () {
                xemo.plugins.Admin.dialogs.CloseDialog(state);
            };
            $(outerframe).append(backbtn, '<hr/>');
            $(outerframe).append(myframe);
        }

        $(state.pframe).children().last().hide();
        $(state.pframe).append(outerframe);
        return myframe;
    },

    /*
        This will close the last dialog opened in the stack.

        _This happens when pressing the back button for example._
    */
    CloseDialog: function (state) {
        $(state.pframe).children().last().remove();
        $(state.pframe).children().last().show();
    },

    /*
        This will destroy all stacked dialogs. 

        _This effectively ends the wizard._
    */
    DestroyDialogStack: function (state) {
        $(state.pframe).empty();
    },

    ShowSuccess: function (state, msg) {
        var frame = this.NewDialog(state);
        $(frame).append('The personnel was updated successfully.');
    },

    SavePersonnel: function (state, tocommit, action) {
        var frame = this.NewDialog(state);
        $(frame).append('Please wait while we save your changes..');        
        xemo.core.commitPersonnel(state.tk.getAuthHash(), tocommit, function (success) {
            alert('success!!!');
        });
    },

    PickPersonnel: function (state, action) {
        var frame = this.NewDialog(state);
        $(frame).append('Fetching personnel from database..');
        xemo.core.getAllPersonnel(state.tk.getAuthHash(), function (data) {
            $(frame).empty();
            var s = document.createElement('select');
            for (var pid in data.personnel) {
                $(s).append('<option value="{4}">{0} {1} {2} {3}</option><br/>'.format(
                    data.personnel[pid].firstname,
                    data.personnel[pid].middlename,
                    data.personnel[pid].lastname,
                    data.personnel[pid].surname,
                    pid
                ));
            }
            $(frame).append(s);
            var btn = document.createElement('input');
            btn.type = 'submit';
            btn.value = 'Pick';
            btn.onclick = function () {
                action(parseInt(s.value), data);
            };
            $(frame).append(btn);
        });
    },

    EditPersonnel: function (state, pid, action, pdata) {
        var frame = this.NewDialog(state);

        function inner(state, pid, action, pdata) {
            var firstname = document.createElement('input');
            var middlename = document.createElement('input');
            var lastname = document.createElement('input');
            var surname = document.createElement('input');
            var dateadded = document.createElement('input');

            if (pid == -1) {
                pdata.personnel[-1] = {
                    firstname:       '',
                    middlename:      '',
                    lastname:        '',
                    surname:         '',
                    dateadded:       (new Date()).getTime() / 1000,
                    paysystem:       []
                }
            }

            firstname.value = pdata.personnel[pid].firstname;
            middlename.value = pdata.personnel[pid].middlename;
            lastname.value = pdata.personnel[pid].lastname;
            surname.value = pdata.personnel[pid].surname;
            dateadded.value = (new Date(pdata.personnel[pid].dateadded * 1000)).shortString();

            $(frame).append('First Name:', firstname, '<br/>');
            $(frame).append('Middle Name: ', middlename, '<br/>');
            $(frame).append('Last Name: ', lastname, '<br/>');
            $(frame).append('Sur Name:', surname, '<br/>');
            $(frame).append('Date Added: ', dateadded, '<br/>');

            function makesysidsel(selected_sysid) {
                var sel = document.createElement('select');
                for (var sysid in pdata.payspecs) {
                    var opt = document.createElement('option');
                    opt.textContent = pdata.payspecs[sysid].sysname;
                    opt.value = sysid;
                    if (sysid == selected_sysid) {
                        opt.selected = true;
                    }
                    $(sel).append(opt);
                }
                return sel;
            }

            var systems = [];
            var psys = pdata.personnel[pid].paysystem;

            $(frame).append(' \
                <div class="xemoPluginAdminWizardEditPersonnelSystemSectionTitle">Systems</div> \
                <div class="xemoPluginAdminWizardEditPersonnelSystemSectionDescription"> \
                This section details the pay systems that are applied to the personnel. There may \
                be multiple systems, however only one system may be in effect at any given time. Each \
                system specified has a <i>start</i> and <i>end</i> pay period identifier. When changing \
                the number the represented pay period is displayed beside the field. \
                </div> \
            ');

            var sysframecont = document.createElement('div');

            function makesysframe(payspecs, sysid, start, end) {
                var sysframe = document.createElement('div');
                sysframe.className = 'xemoPluginAdminWizardEditPersonnelSystemSectionFrame';

                sysid = sysid || 0;
                start = start || 0;
                end = end || 9000;

                var sysidsel = xemo.core.html.UserPaySystemSelector(pdata.payspecs, sysid);

                $(sysframe).append(sysidsel);

                var start_input = new xemo.core.html.UserPayPeriodIDField();
                start_input.setValue(start);

                var end_input = new xemo.core.html.UserPayPeriodIDField();
                end_input.setValue(end);

                $(sysframe).append(start_input);
                $(sysframe).append(end_input);

                sysframe.sysidsel = sysidsel;
                sysframe.start_input = start_input;
                sysframe.end_input = end_input;

                var delbtn = document.createElement('input');
                delbtn.type = 'submit';
                delbtn.value = 'Delete';
                delbtn.onclick = function () {
                    $(sysframe).remove();
                    for (var x = 0; x < systems.length; ++x) {
                        if (systems[x] == sysframe) {
                            systems.splice(x, 1);
                            return;
                        }
                    }
                };

                $(sysframe).append(delbtn);

                systems.push(sysframe);
                $(sysframecont).append(sysframe);                
                return sysframe;
            }

            for (var x = 0; x < psys.length; ++x) {
                var sysid = psys[x].sysid;
                var start = psys[x].start;
                var end = psys[x].end;
                var sysname = pdata.payspecs[sysid].sysname;
                var config = pdata.payspecs[sysid].config;
                var desc = pdata.payspecs[sysid].desc;

                makesysframe(pdata.payspecs, sysid, start, end);
            }

            $(frame).append(sysframecont);

            var addsysbtn = document.createElement('input');
            addsysbtn.type = 'submit';
            addsysbtn.value = 'Add System';
            addsysbtn.onclick = function () {
                makesysframe(pdata.payspecs);
            }

            $(frame).append(addsysbtn);

            var commitbtn = document.createElement('input');
            commitbtn.type = 'submit';
            commitbtn.value = 'Commit';
            commitbtn.onclick = function () {
                var dateadded_unix = new Date(dateadded.value);

                if (!dateadded_unix.isValid()) {
                    alert('You need to check the date added field. It does not appear to be a valid date.');
                    return;
                }

                function cleanstr(s) {
                    var o = [];
                    var v = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
                    var tmp = {};
                    for (var x = 0; x < v.length; ++x) {
                        tmp[v[x]] = true;
                    }
                    s = s.toLowerCase();
                    for (var x = 0; x < s.length; ++x) {
                        if (s[x] in tmp) {
                            o.push(s[x]);
                        }
                    }
                    return o.join('');
                }

                var tocommit = {
                    pid:                pid,
                    firstname:          cleanstr(firstname.value),
                    middlename:         cleanstr(middlename.value),
                    lastname:           cleanstr(lastname.value),
                    surname:            cleanstr(surname.value),
                    dateadded:          Math.floor(dateadded_unix.getTime() / 1000.0),
                    systems:            [],
                };

                for (var x = 0; x < systems.length; ++x) {
                    var sysid = parseInt(systems[x].sysidsel.getSelectedSystemID());
                    var start = parseInt(systems[x].start_input.getValue());
                    var end = parseInt(systems[x].end_input.getValue());

                    if (isNaN(sysid) || isNaN(start) || isNaN(end)) {
                        alert('In one of the system entries one of the fields is not a number.');
                        return;
                    }

                    tocommit.systems.push({
                        sysid:          sysid,
                        start:          start,
                        end:            end
                    });
                }
                action(tocommit);
            };

            $(frame).append(commitbtn);
        }

        // Fetch the data if needed.
        if (pdata == undefined) {
            $(frame).append('Fetching data from database..');
            xemo.core.getAllPersonnel(state.tk.getAuthHash(), function (data) {
                $(frame).empty();
                inner(state, pid, action, data);
            });
        } else {
            inner(state, pid, action, pdata);
        }
    }


}

xemo.plugins.Admin.wizards.EditPersonnel = {
    description:  'I want to change something about a personnel.',
    open:  function (state) {
        xemo.plugins.Admin.dialogs.PickPersonnel(state, function (pid, pdata){
            xemo.plugins.Admin.dialogs.EditPersonnel(state, pid, function (tocommit) {
                xemo.plugins.Admin.dialogs.SavePersonnel(state, tocommit, function () {
                    xemo.plugins.Admin.dialogs.ShowSuccess(state,
                    'The personnel was updated successfully.'
                    );
                });
            }, pdata);
        });
    }
};

xemo.plugins.Admin.wizards.AddPersonnel = {
    description:  'I want to add a new personnel to the system.',
    open: function (state) {
        xemo.plugins.Admin.dialogs.EditPersonnel(state, -1, function (tocommit) {
            xemo.plugins.Admin.dialogs.SavePersonnel(state, tocommit, function () {
                xemo.plugins.Admin.dialogs.ShowSuccess(state, 
                    'The personnel was added successfully.'
                );
            });
        });        
    }
};


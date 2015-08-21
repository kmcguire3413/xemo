const https = require('https');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const core = require('./lib/core.js'); 
const moment = require('moment-timezone');
const twilio = require('twilio');
const domain = require('domain');
const dbjuggle = require('dbjuggle');
const uuid = require('uuid');
const xps = require('./lib/xps.js');

var xemo = {};
xemo.server = {};

xemo.server.padright = function (v, c, w) {
    v = new String(v);
    while (v.length < c) {
        v = w + v;
    }
    return v;
}

xemo.server.datestr = function (y, m, d) {
    y = xemo.server.padright(y, 4, '0');
    m = xemo.server.padright(m, 2, '0');
    d = xemo.server.padright(d, 2, '0');
    return y + '-' + m + '-' + d;
}

xemo.server.handlerL3 = function (db, state, req, res, args, user) {
    switch (args.op) {
        case 'xps.template.compile':
            var templatename = args.templatename.split('/').join('');

            xps.VFS_fromZip('./templates/' + templatename + '.xps', function (vfs) {
                var template = new xps.SinglePageTemplate(vfs);

                console.log('args.cfg_ary', args.cfg_ary);

                template.producePages(
                    args.cfg_ary
                , function (err) {
                    if (err) {
                        xemo.server.dojsonerror(res, 'An error of "' + err + '" occured during XPS template page production.');
                        return;
                    }

                    template.compile();

                    var u = uuid.v4();
                    var upath = './temp/' + u + '.xps';

                    vfs.toZip(upath, function (err) {
                        if (err) {
                            xemo.server.dojsonerror(res, 'An error of "' + err + '" occured during XPS ZIP operation.');
                            return;
                        }

                        xemo.server.dojsonres(res, upath);
                        return;
                    });
                });
            });            
            return;
        case 'training.get.courses':
            var t = db.transaction();
            t.add('SELECT id, title, credithours, weight, level FROM training_courses', [], 'courses');
            t.execute(function (t) {
                xemo.server.dojsonres(res, t.results.courses.rows);
            });
            return;
        case 'training.get.course':
            var t = db.transaction();
            t.add('SELECT section_id, stack, weight FROM training_courses_sections', [], 'sections');
            t.execute(function (t) {
                var rows = t.results.sections.rows;
                for (var x = 0; x < rows.length; ++x) {
                    rows[x]
                }
            });
            break;
        // verify                   verify.cred
        case 'verify' || 'verify.cred':
            console.log('verify.cred');
            xemo.server.dojsonres(res, {
                perm:      user.canwrite ? 1 : 0,
                username:  user.username,
                id:        user.id
            });
            return;            
        // commitPersonnel          personnel.commit
        case 'commitPersonnel' || 'personnel.commit':
            break;
        // enum_years               calendar.enum.years
        case 'enum_years' || 'calendar.enum.years':
            break;
        // enum_months              calendar.enum.months
        case 'enum_months' || 'calendar.enum.months':
            break;
        // dayunlock                calendar.lock.release
        case 'dayunlock' || 'calendar.day.lock.release':
            var t = db.transaction();
            t.add(
                'UPDATE ?? SET lockeduntil = FROM_UNIXTIME(UNIX_TIMESTAMP()) WHERE date = ? AND bypid = ?',
                [
                    'grpdaylock_' + args.grp,
                    args.year + '/' + args.month + '/' + args.day,
                    user.pid
                ]
            );
            t.execute(function () {});
            xemo.server.dojsonres(res, 'success');
            return;
        // daylock                  calendar.lock.acquire
        case 'daylock' || 'calendar.day.lock.acquire':
            var t = db.transaction();

            if (!user.canwrite) {
                xemo.server.dojsonres(res, {
                    code:    'denied',
                    pid:     -2
                });
                return;
            }

            t.add(' \
                INSERT INTO ?? (date, lockeduntil, bypid) VALUES (?, FROM_UNIXTIME(UNIX_TIMESTAMP() + ?), ?) \
                ON DUPLICATE KEY UPDATE \
                    bypid = IF(NOW() > lockeduntil, ?, bypid), \
                    lockeduntil = IF(NOW() > lockeduntil, FROM_UNIXTIME(UNIX_TIMESTAMP() + ?), lockeduntil) \
            ', [
                'grpdaylock_' + args.grp,
                 args.year + '/' + args.month + '/' + args.day,
                 parseInt(args.delta), 
                 user.pid,
                 user.pid,
                 parseInt(args.delta),
            ]);

            t.add(
                'SELECT date, lockeduntil, bypid FROM ?? WHERE date = ?',
                [
                    'grpdaylock_' + args.grp,
                    args.year + '/' + args.month + '/' + args.day
                ],
                'b'
            );

            t.execute(function (t) {
                var rows = t.results.b.rows;
                var success = false;
                var bypid = -1;
                if (rows.length > 0) {
                    bypid = rows[0].bypid;
                    if (rows[0].bypid == user.pid) {
                        success = true;
                    }
                }
                xemo.server.dojsonres(res, {
                    code:    success ? 'accepted' : 'denied',
                    pid:     bypid
                });
                return;
            });
            return;
        // dayread                  calendar.day.read
        case 'dayread' || 'calendar.day.read':
            break;
        // daywrite                 calendar.day.write
        case 'daywrite' || 'calendar.day.write':
            var t = db.transaction();
            t.add(
                'SELECT date, lockeduntil, bypid FROM ?? WHERE date = ?', 
                [
                    'grpdaylock_' + args.grp,
                    args.year + '/' + args.month + '/' + args.day
                ],
                'locktable'
            );
            t.execute(function (t) {
                if (t.results.locktable.rows.length > 0 && t.results.locktable.rows[0].bypid != user.pid) {
                    xemo.server.dojsonres(res, 'denied');
                    return;
                }
                t = db.transaction();
                var txt = args.txt;
                t.add(
                    ' \
                        INSERT INTO ?? (date, text) VALUES (?, ?) \
                        ON DUPLICATE KEY UPDATE \
                        text = ? \
                    ',
                    [
                        'grp_' + args.grp,
                        args.year + '/' + args.month + '/' + args.day,
                        txt,
                        txt
                    ],
                    'grptable'
                );
                t.execute(function (t) {
                    xemo.server.dojsonres(res, 'success');
                });
            })
            return;
        // readcalendar             calendar.range.read
        case 'readcalendar' || 'calendar.range.read':
            var t = db.transaction();

            t.add(
                'SELECT YEAR(date) AS year, MONTH(date) AS month, DAYOFMONTH(date) AS day, text FROM ?? WHERE date >= DATE(?) and date < DATE(?) ORDER BY date',
                [
                    'grp_' + args.grp,
                    xemo.server.datestr(args.from_year, args.from_month, args.from_day), 
                    xemo.server.datestr(args.to_year, args.to_month, args.to_day)
                ],
                'a'
            );

            t.execute(function (reply) {
                var out = [];
                var rows = reply.results.a.rows;
                for (var x = 0; x < rows.length; ++x) {
                    var row = rows[x];
                    out.push([parseInt(row.year), parseInt(row.month), parseInt(row.day), row.text]);
                }
                xemo.server.dojsonres(res, out);
            });
            return;
        // readcalls                events.range.read
        case 'readcalls' || 'events.range.read':
            var t = db.transaction();

            t.add(
                'SELECT id, UNIX_TIMESTAMP(datetime), crew, disposition FROM ilog WHERE datetime >= DATE(?) AND datetime < DATE(?)',
                [
                    args.from_year + '/' + args.from_month + '/' + args.from_day,
                    args.to_year + '/' + args.to_month + '/' + args.to_day,
                ],
                'a'
            );

            t.execute(function (t) {
                var rows = t.results.a.rows;
                var out = [];
                for (var x = 0; x < rows.length; ++x) {
                    out.push([
                        rows[x].id,
                        rows[x].datetime,
                        rows[x].crew,
                        rows[x].disposition
                    ]);
                }
                xemo.server.dojsonres(res, out);
            });
            return;
        // get_personel_attributes  personnel.attributes.get
        case 'get_personel_attributes' || 'personnel.attributes.get':
            break;
        // getpaysysinfo            paysystem.all.get
        case 'paysystem.all.get':
        case 'getpaysysinfo':
            var t = db.transaction();
            t.add('SELECT pid, sysid, start, end FROM personnel_paysystem', [], 'personnel_paysystem');
            t.add('SELECT pid, UNIX_TIMESTAMP(payperiodref) AS payperiodref FROM personnel_payperiodref', [], 'personnel_payperiodref');
            t.add('SELECT sysid, sysname, config, xdesc FROM paysystem_spec', [], 'paysystem_spec');
            t.execute(function (t) {
                var psys = t.results.personnel_paysystem.rows;
                var pref = t.results.personnel_payperiodref.rows;
                var spec = t.results.paysystem_spec.rows;

                var out = {
                    mapping:     {},
                    ppref:       {},
                    systems:     {},
                    error:       {}
                };
                
                if (!args.ids && !args.all) {
                    xemo.server.dojsonres(res, out);
                    return;
                }

                var ids;
                if (!args.ids) {
                    ids = [];
                } else {
                    ids = args.ids.split(',');
                }

                for (var x = 0; x < ids.length; ++x) {
                    ids[x] = parseInt(ids[x]);
                }

                for (var x = 0; x < psys.length; ++x) {
                    if (args.all || ids.indexOf(psys[x].pid) > -1) {
                        if (out.mapping[psys[x].pid] == undefined) {
                            out.mapping[psys[x].pid] = [];
                        }

                        out.mapping[psys[x].pid].push({
                            sysid:     psys[x].sysid,
                            start:     psys[x].start,
                            end:       psys[x].end
                        });
                    }
                }

                for (var x = 0; x < pref.length; ++x) {
                    out.ppref[pref[x].pid] = pref[x].payperiodref;
                }

                for (var x = 0; x < spec.length; ++x) {
                    out.systems[spec[x].sysid] = {
                        sysname:       spec[x].sysname,
                        config:        spec[x].config,
                        desc:          spec[x].xdesc,
                    };
                }
                xemo.server.dojsonres(res, out);
                return;
            });
            return;
        // gen_document             document.generate
        case 'gen_document' || 'document.generate':
            var u = uuid.v4();
            var fout = fs.createWriteStream('./temp/' + u + '.' + args.ext);
            fout.on('open', function () {
                fout.write(args.data);
                fout.close();
                xemo.server.dojsonres(res, '/temp/' + u + '.' + args.ext);
            });
            fout.on('error', function () {
                xemo.server.dojsonerror(res, 'The document was not able to be generated.');
            });
            return;
        // get_personnel_names      personnel.names.fromids
        case 'get_personnel_names' || 'personnel.names.fromids':
            var out = {
                mapping:   {},
                error:     []
            };

            if (!args.ids) {
                xemo.server.dojsonres(res, out);
                return;
            }

            var ids = args.ids.split(',');
            for (var x = 0; x < ids.length; ++x) {
                ids[x] = parseInt(ids[x]);
            }

            var t = db.transaction();

            t.add('SELECT id, firstname, middlename, lastname, surname FROM personnel', [], 'a');
            t.execute(function (t) {
                var rows = t.results.a.rows;
                for (var x = 0; x < rows.length; ++x) {
                    var row = rows[x];
                    var ndx = ids.indexOf(row.id);
                    if (ndx > -1) {
                        out.mapping[row.id] = [row.firstname, row.middlename, row.lastname, row.surname].join(' ');
                        ids.splice(ndx, 1);
                    }
                }
                out.error = ids;
                xemo.server.dojsonres(res, out);
            });
            return;
        // get_personnel_data       personnel.all.get
        case 'personnel.all.get':
        case 'get_personnel_data':
            var t = db.transaction();

            t.add('SELECT id, firstname, middlename, lastname, surname, UNIX_TIMESTAMP(dateadded) AS dateadded, smsphone FROM personnel', [], 'personnel');
            t.add('SELECT id, canwrite FROM personnel_perm', [], 'perm');
            t.execute(function (t) {
                var rows = t.results.personnel.rows;
                var out = {};
                for (var x = 0; x < rows.length; ++x) {
                    var row = rows[x];
                    out[row.id] = {
                        firstname:   row.firstname,
                        middlename:  row.middlename,
                        lastname:    row.lastname,
                        surname:     row.surname,
                        dateadded:   row.dateadded,
                        smsphone:    row.smsphone,
                        canwrite:    false
                    };
                }
                var rows = t.results.perm.rows;
                for (var x = 0; x < rows.length; ++x) {
                    var id = rows[x].id;
                    if (out[id]) {
                        out[id].canwrite = rows[x].canwrite == 1 ? true : false;
                    }
                }
                xemo.server.dojsonres(res, out);
                return;
            });
            return;
        // get_personnel_ids        personnel.ids.fromnames
        case 'get_personnel_ids' || 'personnel.ids.fromnames':
            break;
    }

    xemo.server.dojsonerror(res, 'The operation was not supported.');
    //res.writeHead(200, { 'Content-Type': 'text/html' });
    //res.end('hello world');
}

xemo.server.doresponse = function (res, type, data) {
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
}

xemo.server.dojsonres = function (res, data) {
    data = {
        code:   'success',
        result: data
    };
    xemo.server.doresponse(res, 'text/html', JSON.stringify(data));
}

xemo.server.dojsonerror = function (res, message) {
    var data = {
        code:   'error',
        error:  message 
    };
    xemo.server.doresponse(res, 'text/html', JSON.stringify(data));
}

xemo.server.handlerL2 = function (state, req, res, args, url) {
    if (url != '/interface') {
        if (url == '' || url == '/') {
            url = 'index.html';
        }

        console.log('serving url [' + url + ']');
        url = url.replace('..', '.');

        var ext = null;
        var type = 'text/plain';

        if (url.indexOf('.') > -1) {
            ext = url.substring(url.indexOf('.') + 1);
        }

        switch (ext) {
            case null: type = 'text/plain'; break;
            case 'css': type = 'text/css'; break;
            case 'gif':  type = 'image/gif'; break;
            case 'html': type = 'text/html'; break;
            case 'png': type = 'image/png'; break;
            case 'xml': type = 'text/xml'; break;
            case 'xsl': type = 'text/xsl; charset=utf-8;'; break;
            default:
                console.log('unknown extension ' + ext);
                type = 'text/plain';
                break;

        }        

        var fstream = fs.createReadStream('./' + url);

        fstream.on('open', function () {
            res.writeHead(200, { 'Content-Type': type });
            fstream.pipe(res);
        });

        fstream.on('error', function (err) {
            console.log('err: ' + err);
            res.writeHead(400, { 'Content-Type': type });
            res.end(err);
        });

        fstream.on('end', function () {
            res.end();
        });

        return;
    }

    /*
        This database instance may be from a pool and may need to
        be closed properly. Since there are so many executions paths
        that asynchronous it seems to be very easy to leak a connection
        so we attach it to the server response object, and hopefully
        it ends up released/closed. Also, we should be catching all
        exceptions in our domain or anywhere else therefore we can
        also try to release/close it there as well if needed. 
    */
    dbjuggle.opendatabase(state.db, function (err, db) {
        if (err) {
            xemo.server.dojsonerror(res, 'There was an error connecting to the database.');
            return;
        }
        res.dbconn = db;    

        var t = db.transaction();
        t.add('SELECT id, username FROM personnel_auth WHERE hash = ?', [args.key], 'a');
        t.execute(function (reply) {
            if (reply.results.a.rows.length == 0) {
                xemo.server.dojsonerror(res, 'The username and password were rejected.');
                return;
            }

            console.log('got id: ' + reply.results.a.rows[0].id);
            
            var user = {
                pid:        reply.results.a.rows[0].id,
                username:   reply.results.a.rows[0].username
            };

            console.log('getting user permissions');
            var t = db.transaction();
            t.add('SELECT canwrite FROM personnel_perm WHERE id = ?', [user.pid], 'a');
            t.execute(function (reply) {
                if (reply.results.a.rows.length == 0) {
                    console.log('user had no permissions set in the database (' + user.pid + ')');
                    xemo.server.dojsonerror(res, 'The user has no permissions set in the database.');
                    return;
                }

                if (reply.results.a.rows[0].canwrite[0] == 1) {
                    user.canwrite = true;
                } else {
                    user.canwrite = false;
                }

                console.log('doing operation');
                xemo.server.handlerL3(db, state, req, res, args, user);
            });
        });
    });
}

xemo.server.handlerL1 = function (state, req, res, data) {
    var args = {};
    var url = req.url;
    if (url.indexOf('?') > -1) {
        var _args = url.substring(url.indexOf('?') + 1);
        _args = _args.split('&');
        for (var x = 0; x < _args.length; ++x) {
            var pair = _args[x].split('=');
            var key = pair[0];
            var value = pair[1];
            value = decodeURI(value);
            args[key] = value;
        }
        url = url.substring(0, url.indexOf('?'));
    }

    if (data != null) {
        var eargs = JSON.parse(data);
        for (var k in eargs) {
            args[k] = eargs[k];
        }
    }

    console.log('URL: ' + url);
    console.log(args);


    xemo.server.handlerL2(state, req, res, args, url);
}

xemo.server.doredirect = function (res, url) {
    res.writeHead(302, { 'Location': url });
    res.end();
}

xemo.server.handlerL0 = function (state, req, res) {
    try {
        /*
            The Xemo system supports a lot of configuration options
            which can create some long URLs. In order to shorten the
            URLs and make them easier to read I have added this
            code here. I hope to link it to the database instead of
            hard coding it here.
        */       
        switch (req.url) {
            case '/edit':
                xemo.server.doredirect(res, '/?no_menu=true&oldstyle=true&plug_login_redirect=Calendar&plug_calendar_group=medic');
                return;
            case '/sonia':
                xemo.server.doredirect(res, '/?no_menu=true&oldstyle=true&plug_login_redirect=Calendar&plug_calendar_group=medic&passhash=62d2fd8e33e2b6b6a75d4f5c3bdeade58af155455276e69cb1a1a1aa942eb117e52ae8c5ec802b718413fa82f01836d933431837cbfe9dfadc86710e4a888f58');
                return;
            case '/driver':
                xemo.server.doredirect(res, '/?no_menu=true&oldstyle=true&plug_login_half=true&plug_login_redirect=Calendar&plug_calendar_group=driver');
                return;
            case '/medic':
                xemo.server.doredirect(res, '/?no_menu=true&oldstyle=true&plug_login_half=true&plug_login_redirect=Calendar&plug_calendar_group=medic');
                return;
        }

        const method = req.method;
        if (method == 'POST') {   
            var data = []; 
            var datatotalsize = 0;
            req.on('data', function (chunk) {
                datatotalsize += chunk.length;
                if (datatotalsize > 1024 * 1024 * 4) {
                    // Disable this potential DOS attack by limiting
                    // the POST data to 4Mbytes.
                    res.writeHead(403);
                    res.end();
                    return;
                }
                data.push(chunk);
            });

            req.on('end', function () {
                xemo.server.handlerL1(state, req, res, data.join(''));
            });
            return;
        }

        xemo.server.handlerL1(state, req, res, null);
    } catch (err) {
        // To prevent the destruction of the entire server
        // we need to catch thrown errors here. Then log
        // these errors for diagnostics.
        console.log(err.stack);
    }
}

/*
    This contains the logic used to keep a log of who
    has been notified. It is powered locally by a in
    memory cache of recent notifications, and then backed
    by a database for persistence across process restarts.
*/
xemo.server.NotifyLog = function (state) {
    this.cache = [];

    this.hasBeenNotified = function (db, pid, notifiedfor, system, cb) {
        /*
            Check our local cache first to reduce latency and load.
        */
        for (var x = 0; x < this.cache.length; ++x) {
            var centry = this.cache[x];
            if (centry.pid == pid && centry.notifiedfor == notifiedfor && centry.system == system) {
                cb(true, null, null);
                return;
            }
        }
        
        var t = db.transaction();
        
        t.add(' \
                SELECT id, state FROM notifylog \
                WHERE pid = ? AND \
                UNIX_TIMESTAMP(notifiedfor) = ? AND \
                system = ? \
            ', 
            [pid, notifiedfor, system], 
            'notifylog'
        );

        t.execute(function (t) {
            var rows = t.results.notifylog.rows;
            if (rows.length > 0) {
                cb(true, rows[0].id, rows[0].state);
                return;
            }
            cb(false, null, null);
        });
    };

    this.logNotification = function (db, pid, notifiedfor, system, state) {
        this.cache.push({
            pid:            pid,
            notifiedfor:    notifiedfor,
            system:         system,
            state:          state
        });

        var t = db.transaction();
        t.add(
            'INSERT INTO notifylog (pid, notifiedon, notifiedfor, system, state) VALUES (?, NOW(), FROM_UNIXTIME(?), ?, ?)',
            [pid, notifiedfor, system, state],
            'notifylog'
        );
        t.execute(function (t) {
            console.log(t.results.notifylog.err);
        });
    };

    return this;
}

xemo.server.notifybysms = function (phonenum, message) {    
    xemo.server.notifybysms.count = xemo.server.notifybysms.count || 1;
    ++xemo.server.notifybysms.count;

    // TODO: SAFEGUARD..
    //if (xemo.server.notifybysms.count > 8) {
    //    return;
    //}

    console.log('NOTIFIED ' + phonenum);

    //return;

    var client = twilio(
        'AC30481d7178414b654e8e0f7406cecf8f',
        '4f34e8ec17500b189fe370056a2c167d'
    );

    /*
        We can pass a callback as the second parameter, but I opted
        to not worry about that, because to make usage of it I would
        have to track it, and the system could be prone to bugs and
        if it opted to send multiple message there is a chance that
        someone could continously get text messages and that would
        be bad.
    */

    client.sendMessage({
        to:    '+13345807300', //phonenum,
        from:  '+13345131715',
        body:  message
    });

    client.sendMessage({
        to:    '+13346572491', //phonenum,
        from:  '+13345131715',
        body:  message
    });
}

xemo.server.shiftnotify = function (db, state, group, notifytable, cb) {
    if (xemo.server.notifylog == undefined) {
        xemo.server.notifylog = new xemo.server.NotifyLog(state);
    }

    var t = db.transaction();

    var sd = new Date();
    sd = new Date(sd.getFullYear(), sd.getMonth(), sd.getDate());
    var ed = new Date();
    ed = new Date(ed.getFullYear(), ed.getMonth(), ed.getDate());
    ed.setDate(ed.getDate() + 2);

    t.add(
        'SELECT YEAR(date) AS year, MONTH(date) AS month, DAYOFMONTH(date) AS day, text FROM ?? WHERE date >= FROM_UNIXTIME(?) and date < FROM_UNIXTIME(?) ORDER BY date',
        [
            'grp_' + group,
            sd.getTime() / 1000,
            ed.getTime() / 1000
        ],
        'a'
    );

    console.log('[SCHEDNOTIFY] querying the database for the schedule for group ' + group);

    t.execute(function (reply) {
        var out = [];
        var rows = reply.results.a.rows;
        for (var x = 0; x < rows.length; ++x) {
            var row = rows[x];
            out.push({
                year: parseInt(row.year), 
                month: parseInt(row.month), 
                day: parseInt(row.day), 
                text: row.text
            });
        }

        var refined = [];

        for (var i = 0; i < out.length; ++i) {
            // Read the record fields.
            var entry = out[i];

            var lines = entry.text.split('\n');
            core.textcalendar.parseLinesIntoShifts(lines, function (name, start, end) {
                var shift = core.textcalendar.makeRoughShift(entry.year, entry.month, entry.day, name, start, end);
                refined.push(shift);                
            });
        }

        core.textcalendar.refineRoughShifts(refined, function (year, month, day, hour, minute) {
            // This needs to be updated to fetch the timezone for the calendar and use that.
            return new Date(moment.tz({
                year: year,
                month: month,
                day: day,
                hour: hour,
                minute: minute
            }, 'America/Chicago'));
        });

        var t = db.transaction();
        t.add('SELECT id, firstname, middlename, lastname, surname, dateadded, smsphone FROM personnel', [], 'a');
        t.execute(function (t) {
            if (t.results.a.err) {
                console.log('[SHIFTNOTIFY] encountered error fetching tables for ' + group);
                return;
            }

            var out = t.results.a.rows;
            var pdata = {};

            for (var ndx = 0; ndx < out.length; ++ndx) {
                var row = out[ndx];
                pdata[row.id] = {
                    firstname:     row.firstname,
                    middlename:    row.middlename,
                    lastname:      row.lastname,
                    surname:       row.surname,
                    dateadded:     row.dateadded,
                    smsphone:      row.smsphone
                };
            }

            var cd = new Date();

            for (var ndx = 0; ndx < refined.length; ++ndx) {
                var shift = refined[ndx];

                /* Ignore shifts in the past. */
                if (cd > shift.start) {
                    continue;
                }

                /*
                    Compute the notification time for this shift start time,
                    and also make sure it is in the local time.
                */
                var ntime = moment.tz(shift.start, 'America/Chicago');
                var nte = notifytable[parseInt(ntime.format('HH'))];
                ntime.date(ntime.date() - 1);
                ntime.hours(nte[0]);

                //console.log('name', shift.name);
                //console.log('shift.start', moment.tz(shift.start, 'America/Chicago').format('MMM, Do HH:mm'));
                //console.log('notification', ntime.format('MMM, Do HH:mm'));

                if (cd < ntime) {
                    continue;
                }

                //console.log('NOTIFIED');

                var result = core.getPersonnelIDFromName(pdata, shift.name, shift.start);

                if (result[0] == 1) {
                    shift.pid = result[1];
                    if (pdata[shift.pid].smsphone == null) {
                        /*
                            We do not have a SMS phone number for this personnel
                            so we are not going to worry about notifying them.
                        */
                        continue;
                    }
                    shift.smsphone = pdata[shift.pid].smsphone;
                } else {
                    /*
                        We could not resolve the personnel therefore we will make sure that we
                        let someone know that there was a problem by sending them a notification.
                    */
                    function _$a(shift, result) {
                        return function (wasnotified) {
                            if (!wasnotified) {
                                xemo.server.notifylog.logNotification(
                                    db,
                                    -1,
                                    shift.start.getTime() / 1000,
                                    'SCHED_SMS_ERROR_' + group,
                                    0
                                );

                                var errorstr;
                                switch (result[0]) {
                                    case -1:
                                        errorstr = 'multiple matches: ' + result[1].join(', ');
                                        break;
                                    case 0:
                                        errorstr = 'could not be matched with any personnel';
                                        break;
                                }

                                var lstart = moment.tz(shift.start, 'America/Chicago');

                                if (shift.name == '<nobody>') {
                                    msg = 'The ' + group.toUpperCase() + ' schedule has a shift with no one assigned on ' +
                                          lstart.format('MMM, Do HH:mm') + '.';
                                } else {
                                    msg = 
                                        'The name "' + shift.name + '" could not be matched to a personnel.\n\n' +
                                        'Unable to determine phone number.\n\n' +
                                        'Error was: "' + errorstr + '"\n\n' + 
                                        'Shift: ' + lstart.format('MMM, Do HH:mm') + '\n' +
                                        '\n' +
                                        'To fix requires schedule edit.';
                                }

                                xemo.server.notifybysms(
                                    '+13345807300',
                                    'EMS Schedule Admin Notification\n\n' +
                                    msg
                                );
                            }
                        };
                    }

                    xemo.server.notifylog.hasBeenNotified(
                        db,
                        -1, shift.start.getTime() / 1000, 'SCHED_SMS_ERROR_' + group,
                        _$a(shift, result)
                    );
                    continue;
                }           

                function _$b(shift) {
                    return function (wasnotified) {
                        if (!wasnotified) {
                            console.log('[SCHEDNOTIFY] notifying by SMSPHONE.. ' + shift.name + ':' + shift.pid + ':' + shift.start);
                            xemo.server.notifylog.logNotification(
                                db,
                                shift.pid, 
                                shift.start.getTime() / 1000, 
                                'SCHED_SMS_' + group, 0
                            );

                            var lstart = moment.tz(shift.start, 'America/Chicago');

                            var deltahours = new String((shift.start.getTime() - cd.getTime()) / 1000 / 60 / 60);

                            /*
                                I could not find a decent rounding function in the javascript
                                standard library, but this should work fine. If this was a hot
                                execution path then we could surely try a different method, but
                                I expect this to be a very cold path for a long time.
                            */
                            if (deltahours.indexOf('.') > -1) {
                                deltahours = Math.round(deltahours * 10.0) / 10.0; 
                            }

                            xemo.server.notifybysms(
                                shift.smsphone, 
                                'EMS Schedule Notification System\n' +
                                '\n' +
                                'For: ' + shift.name.toUpperCase() + '\n' +
                                '\n' +
                                'YOU are scheduled ON DUTY for ' + group.toUpperCase() + ' on ' +
                                lstart.format('MMM, Do') + ' at ' + lstart.format('HH:mm') + '\n'
                            );
                        }
                    };
                }

                xemo.server.notifylog.hasBeenNotified(
                    db,
                    shift.pid, shift.start.getTime() / 1000, 'SCHED_SMS_' + group, 
                    _$b(shift)
                );
            }
            cb();
        });
    });
}

xemo.server.fatalRequestError = function (err, res) {
    console.log('FatalRequestError');
    console.log(res);

    if (res) {
        xemo.server.dojsonerror(res, 'FatalRequestError: ' + err.stack);
    }
    return;
}

xemo.server.crashLooper = function (delay, args, cb) {
    var notifydom = domain.create();

    /*
        In many cases the repeat() may end up called, but
        some async paths may fire with an error and thus
        attempt to repeat. We have to catch them here and
        deny the repeat if it has already been done.
    */
    var started = [false];

    function repeat () {
        if (!started[0]) {
            started[0] = true;
            xemo.server.crashLooper(delay, args, cb);
        }
    }

    notifydom.on('error', function (err) {
        console.log('NOTIFIER CRASHED');
        console.log(err);
        repeat();
    });      

    setTimeout(function () {
        notifydom.run(function () {
            process.nextTick(function () {
                console.log('crash looper started');
                cb(delay, args, repeat);
            });
        });
    }, delay);
}

xemo.server.doNotifier = function (delay, args, repeat) {
    dbjuggle.opendatabase(args.state.db, function (err, db) {
        if (err) {
            repeat();
            return;
        }
        /*
            The only way to ensure this process is long living
            is to release these database instances. I may be
            able create a database pool that reclaims connections
            that have been inactive for a significant time, but
            for now let us see if this works good.
        */
        xemo.server.notifylog = undefined;
        xemo.server.shiftnotify(db, args.state, args.group, args.notifytable, function () {
            repeat();
        });
    });
}

xemo.server.oldSystemSync = function (delay, args, repeat) {
    dbjuggle.opendatabase(args.state.db, function (err, db) {
        if (err) {
            console.log('can not open the database');
            repeat();
        }

        var nodes = fs.readdir(args.path, function (err, nodes) {
            if (err) {
                console.log('unable to read old system path');
                repeat();
            }

            args.pending = 0;

            for (var x = 0; x < nodes.length; ++x) {
                var parts = nodes[x].split('.');

                if (parts[0] == 'data' && parts.length == 4) {
                    if (parts[1] == 'Driver' || parts[1] == 'Medic') {
                        args.todo = [];
                        
                        var group = parts[1].toLowerCase();
                        var year = parseInt(parts[2]);
                        var month = parseInt(parts[3]);

                        ++args.pending;
                        function __worknode(group, year, month, node) {
                            fs.readFile(
                                args.path + '/' + nodes[x], 
                                { encoding: 'utf-8' }, function (err, data) {
                                    data = data.split('\n');

                                    for (var x = 0; x < data.length - 1; ++x) {
                                        var text = data[x].split('\t').join('\n');
                                        var datestr = year + '/' + month + '/' + (x + 1);

                                        args.todo.push({ 
                                            group:    'grp_' + group,
                                            datestr:  datestr,
                                            text:     text
                                        });
                                    }

                                    --args.pending;
                                    if (args.pending < 1) {
                                        /*
                                            When this happens we have pending.
                                        */
                                        dbjuggle.opendatabase(args.state.db, function (err, db) {
                                            var t = db.transaction();
                                            for (var x = 0; x < args.todo.length; ++x) {
                                                t.add(
                                                    ' \
                                                        INSERT INTO ?? (date, text) VALUES (?, ?) \
                                                        ON DUPLICATE KEY UPDATE text = ? \
                                                    ',
                                                    [
                                                        args.todo[x].group,
                                                        args.todo[x].datestr,
                                                        args.todo[x].text,
                                                        args.todo[x].text
                                                    ]
                                                );
                                            }
                                            console.log('synchronized ' + args.todo.length + ' calendar entries from the old system');
                                            /*
                                                Just to be safe. Lets clear it.
                                            */
                                            args.todo = undefined;
                                            t.execute();
                                            repeat();
                                        });
                                    }
                            });
                        }

                        __worknode(group, year, month, nodes[x]);
                    }

                    /*
                        If args.pending < 0 here then we do not
                        need to do anything.
                    */
                    if (args.pending < 0) {
                        repeat();
                    }
                }
            }
        });
    });
}

xemo.server.start = function (state, port) {
    xemo.server.crashLooper(1000 * 60 * 3, { state: state, path: '/home/kmcguire/www/dschedule' }, xemo.server.oldSystemSync);

    /*
        This is the notification table. For each time
        specified on the left the time specified on the
        right is when a notification will happen for that
        time on the left. The value on the right has two
        parts. It has a time and a day offset which represents 
        the numbers of days prior.

        For 01:24 the notification time would be 08:24 the
        previous day. For 00:45 the notification time would be
        08:00 the previous day.
    */
    var ntbl = {
        0:  [8, 1],
        1:  [8, 1],
        2:  [8, 1],
        3:  [8, 1],
        4:  [8, 1],
        5:  [8, 1],
        6:  [8, 1],
        7:  [8, 1],
        8:  [8, 1],
        9:  [9, 1],
        10: [10, 1],
        11: [11, 1],
        12: [12, 1],
        13: [13, 1],
        14: [14, 1],
        15: [15, 1],
        16: [16, 1],
        17: [17, 1],
        18: [18, 1],
        19: [19, 1],
        20: [20, 1],
        21: [8, 0],
        22: [8, 0],
        23: [8, 0],
    };

    xemo.server.crashLooper(5000, { state: state, group: 'driver', notifytable: ntbl }, xemo.server.doNotifier);
    //xemo.server.crashLooper(5000, { state: state, group: 'medic', notifytable: ntbl }, xemo.server.doNotifier);

    function handle_http_request(req, res) {
      var reqdom = domain.create();
        reqdom.on('error', function (err) {
            console.log(err.stack);
            if (res.dbconn) {
                res.dbconn.release();
            }
        });

        reqdom.run(function () {
            process.nextTick(function () {
                xemo.server.handlerL0(state, req, res);
            });
        });        
    }

    http.createServer(function (req, res) {
        handle_http_request(req, res);
    }).listen(7634);

    var https_options = {
        key: fs.readFileSync('/home/kmcguire/www-data-keys/startssl.com/ssl.key.un'),
        cert: fs.readFileSync('/home/kmcguire/www-data-keys/startssl.com/ssl.cert'),
        ciphers: 'EECDH+AESGCM:EDH+AESGCM:ECDHE-RSA-AES128-GCM-SHA256:AES256+EECDH:DHE-RSA-AES128-GCM-SHA256:AES256+EDH:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-SHA384:ECDHE-RSA-AES128-SHA256:ECDHE-RSA-AES256-SHA:ECDHE-RSA-AES128-SHA:DHE-RSA-AES256-SHA256:DHE-RSA-AES128-SHA256:DHE-RSA-AES256-SHA:DHE-RSA-AES128-SHA:ECDHE-RSA-DES-CBC3-SHA:EDH-RSA-DES-CBC3-SHA:AES256-GCM-SHA384:AES128-GCM-SHA256:AES256-SHA256:AES128-SHA256:AES256-SHA:AES128-SHA:HIGH:!aNULL:!eNULL:!EXPORT:!DES:!MD5:!PSK:!RC4',
        honorCipherOrder: true,
        //passphrase: 'xsjqoxnvye7389sdx7292jsnmzs8203'
    };

    https.createServer(https_options, function (req, res) {
        console.log('got https req');
        handle_http_request(req, res);
    }).listen(7635);    
};

xemo.server.utility = {};
xemo.server.utility.sqlite3migrate = function () {
    const sql3 = dbjuggle.opendatabase({
        type:     'sqlite3',
        path:     './data.db' 
    });
    const mysql = dbjuggle.opendatabase({
        type:     'mysql',
        host:     'localhost',
        dbname:   'xemo',
        user:     'xemo',
        pass:     'OLXk394VBCnxDJFgxk'
    });

    var t = sql3.transaction();
    //t.add('SELECT id, description, division FROM attributes', [], 'attributes');

    t.add('SELECT personnel_id, crew_id, crew_function_id FROM crew', [], 'crew');
    t.add('SELECT id, description FROM crew_function', [], 'crew_function');
    t.add('SELECT date, text FROM grp_driver', [], 'grp_driver');
    t.add('SELECT date, text FROM grp_medic', [], 'grp_medic');
    t.add('SELECT date, lockeduntil, bypid FROM grpdaylock_driver', [], 'grpdaylock_driver');
    t.add('SELECT date, lockeduntil, bypid FROM grpdaylock_medic', [], 'grpdaylock_medic');
    t.add('SELECT id, name FROM idisposition', [], 'idisposition');
    t.add('SELECT id, datetime, location, crew, disposition FROM ilog', [], 'ilog');
    t.add('SELECT sysid, sysname, config, desc, payperiodref FROM paysystem_spec', [], 'paysystem_spec');
    t.add('SELECT id, firstname, middlename, lastname, surname, dateadded, smsphone FROM personnel', [], 'personnel');
    t.add('SELECT id, username, hash FROM personnel_auth', [], 'personnel_auth');
    t.add('SELECT pid, payperiodref FROM personnel_payperiodref', [], 'personnel_payperiodref');
    t.add('SELECT pid, sysid, start, end FROM personnel_paysystem', [], 'personnel_paysystem');
    t.add('SELECT id, canwrite FROM personnel_perm_rw', [], 'personnel_perm_rw');
    t.execute(function (a) {
        console.log('starting migration to mysql');
        var b = mysql.transaction();
        // INT = 4
        // BIGINT = 8     TINYINT=1   SMALLINT=2
        // 

        /*
        b.add('DROP TABLE crew');
        b.add('DROP TABLE crew_function');
        b.add('DROP TABLE grpdaylock_driver');
        b.add('DROP TABLE grpdaylock_medic');
        b.add('DROP TABLE idisposition');
        b.add('DROP TABLE ilog');
        b.add('DROP TABLE personnel');
        b.add('DROP TABLE personnel_auth');
        b.add('DROP TABLE personnel_paysystem');
        b.add('DROP TABLE personnel_perm');
        */
        b.add('DROP TABLE grp_driver');
        b.add('DROP TABLE grp_medic');        
        b.add('DROP TABLE personnel_payperiodref');
        b.add('DROP TABLE paysystem_spec');
        
        /*
        b.add('CREATE TABLE crew (personnel_id BIGINT NOT NULL, crew_id VARCHAR(64) NOT NULL, crew_function_id INT NOT NULL)');
        b.add('CREATE TABLE crew_function (id INT PRIMARY KEY, description VARCHAR(1024) NOT NULL)');
        b.add('CREATE TABLE grpdaylock_driver (date DATE PRIMARY KEY, lockeduntil DATETIME NOT NULL, bypid BIGINT NOT NULL)');
        b.add('CREATE TABLE grpdaylock_medic (date DATE PRIMARY KEY, lockeduntil DATETIME NOT NULL, bypid BIGINT NOT NULL)');
        b.add('CREATE TABLE idisposition (id INT PRIMARY KEY, name VARCHAR(128) NOT NULL)');
        b.add('CREATE TABLE ilog (id BIGINT PRIMARY KEY, datetime DATETIME NOT NULL, location VARCHAR(256) NOT NULL, crew VARCHAR(64), disposition INT NOT NULL)');
        b.add('CREATE TABLE personnel (id BIGINT PRIMARY KEY, firstname VARCHAR(60), middlename VARCHAR(60), lastname VARCHAR(60), surname VARCHAR(60), dateadded DATETIME NOT NULL, smsphone VARCHAR(30))');
        b.add('CREATE TABLE personnel_auth (id BIGINT PRIMARY KEY, username VARCHAR(128) NOT NULL, hash VARCHAR(256) NOT NULL)');
        b.add('CREATE TABLE personnel_paysystem (pid BIGINT, sysid INT NOT NULL, start INT NOT NULL, end INT)');
        b.add('CREATE TABLE personnel_perm (id BIGINT PRIMARY KEY, canwrite BIT(1) NOT NULL)');
        */
        b.add('CREATE TABLE grp_driver (date DATE PRIMARY KEY, text VARCHAR(1024) NOT NULL)');
        b.add('CREATE TABLE grp_medic (date DATE PRIMARY KEY, text VARCHAR(1024) NOT NULL)');        
        b.add('CREATE TABLE personnel_payperiodref (pid BIGINT PRIMARY KEY, payperiodref DATETIME NOT NULL)');
        b.add('CREATE TABLE paysystem_spec (sysid INT PRIMARY KEY, sysname VARCHAR(128) NOT NULL, config VARCHAR(4096), xdesc VARCHAR(1024) NOT NULL)');

        function h1(table, rows, cols, cb, q) {
            if (!q) {
                q = [];
                for (var x = 0; x < cols.length; ++x) {
                    q.push('?');
                }
            }
            q = q.join(', ');
            for (var x = 0; x < rows.length; ++x) {
                var row = rows[x];
                var params = cb(row);
                params.splice(0, 0, table);
                b.add('INSERT INTO ?? (' + cols.join(', ') + ') VALUES (' + q + ')', params);
            }
        }

        h1(
            'paysystem_spec', a.results.paysystem_spec.rows,
            ['sysid', 'sysname', 'config', 'xdesc'],
            function (row) {
                return [row.sysid, row.sysname, row.config, row.desc];
            }
        );


        h1(
            'personnel_payperiodref', a.results.personnel_payperiodref.rows,
            ['pid', 'payperiodref'],
            function (row) {
                return [row.pid, row.payperiodref];
            },
            ['?', 'FROM_UNIXTIME(?)']
        );

        /*
        h1(
            'personnel_perm', a.results.personnel_perm_rw.rows,
            ['id', 'canwrite'],
            function (row) {
                return [row.id, row.canwrite];
            }
        );

        h1(
            'personnel_paysystem', a.results.personnel_paysystem.rows,
            ['pid', 'sysid', 'start', 'end'],
            function (row) {
                return [row.pid, row.sysid, row.start, row.end];
            }
        );

        h1(
            'personnel_auth', a.results.personnel_auth.rows,
            ['id', 'username', 'hash'],
            function (row) {
                return [row.id, row.username, row.hash];
            }
        );

        h1(
            'personnel', a.results.personnel.rows,
            ['id', 'firstname', 'middlename', 'lastname', 'surname', 'dateadded', 'smsphone'],
            function (row) {
                return [row.id, row.firstname, row.middlename, row.lastname, row.surname, row.dateadded, row.smsphone];
            }
        );

        h1(
            'ilog', a.results.ilog.rows,
            ['id', 'datetime', 'location', 'crew', 'disposition'],
            function (row) {
                return [row.id, row.datetime, row.location, row.crew, row.disposition];
            },
            ['?', 'FROM_UNIXTIME(?)', '?', '?', '?']
        );

        h1(
            'idisposition', a.results.idisposition.rows,
            ['id', 'name'],
            function (row) {
                return [row.id, row.name];
            }
        );  

        h1(
            'crew', a.results.crew.rows, 
            ['personnel_id', 'crew_id', 'crew_function_id'],
            function (row) {
                return [row.personnel_id, row.crew_id, row.crew_function_id];
            }
        );

        h1(
            'crew_function', a.results.crew_function.rows,
            ['id', 'description'],
            function (row) {
                return [row.id, row.description];
            }
        );
        */

        h1(
            'grp_driver', a.results.grp_driver.rows,
            ['date', 'text'],
            function (row) {
                return [(row.date - 1721059.5), row.text.split('\x06').join('\n')];
            },
            ['FROM_DAYS(?)', '?']
        );

        h1(
            'grp_medic', a.results.grp_medic.rows,
            ['date', 'text'],
            function (row) {
                return [(row.date - 1721059.5), row.text.split('\x06').join('\n')];
            },
            ['FROM_DAYS(?)', '?']
        );

        b.execute(function (b) {
            console.log('migration finished');
            b.commit();
        });        
    });  
};

//xemo.server.utility.sqlite3migrate();

xemo.server.start({
    /*
        The base URL to access the root directory of the server.
    */
    baseurl:      'http://kmcg3413.net:7634/',
    /*
        The database configuration.
    */
    db: {
        //type:    'sqlite3',
        //path:    './data.db'
        type:     'mysql',
        host:     'localhost',
        dbname:   'xemo',
        user:     'xemo',
        pass:     'OLXk394VBCnxDJFgxk'
    }
});


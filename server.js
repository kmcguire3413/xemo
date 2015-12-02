var https = require('https');
var http = require('http');
var fs = require('fs');
var crypto = require('./lib/sha512.js');
var core = require('./lib/core.js'); 
var moment = require('moment-timezone');
var twilio = require('twilio');
var domain = require('domain');
var dbjuggle = require('dbjuggle');
var uuid = require('uuid');
var xps = require('./lib/xps.js');

var xemo = {};

/**
    This contains all the server specific components
    for Xemo.
*/
xemo.server = {};

xemo.server.padright = function (v, c, w) {
    v = new String(v);
    while (v.length < c) {
        v = w + v;
    }
    return v;
};

xemo.server.datestr = function (y, m, d) {
    y = xemo.server.padright(y, 4, '0');
    m = xemo.server.padright(m, 2, '0');
    d = xemo.server.padright(d, 2, '0');
    return y + '-' + m + '-' + d;
};

xemo.server.read_calendar = function (db, args, cb) {
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
    t.add(
        'SELECT UNIX_TIMESTAMP(changed_when) AS changed_when FROM grpchangelog WHERE grpname = ? ORDER BY changed_when DESC LIMIT 1', [args.grp], 'last'
    );

    console.log('@@@');
    t.execute(function (reply) {
        var out = [];
        var rows = reply.results.a.rows;
        for (var x = 0; x < rows.length; ++x) {
            var row = rows[x];
            out.push([parseInt(row.year), parseInt(row.month), parseInt(row.day), row.text]);
        }
        var last = 0;
        if (reply.results.last.rows.length > 0) {
            last = reply.results.last.rows[0].changed_when;
        }
        cb(out, last);
    });
};

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
            t.execute(function (t) {
                t.commit();
            });
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

            t.add(
                'SELECT text FROM ?? WHERE date = ?',
                [
                    'grp_' + args.grp,
                    args.year + '/' + args.month + '/' + args.day
                ],
                'c'
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

                var freshtext;

                if (t.results.c.rows.length < 1) {
                    freshtext = '<error>';
                    success = false;
                } else {
                    freshtext = t.results.c.rows[0].text;
                }

                t.commit();

                xemo.server.dojsonres(res, {
                    code:       success ? 'accepted' : 'denied',
                    pid:        bypid,
                    freshtext:  freshtext
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
                    t.commit();
                    xemo.server.dojsonres(res, 'success');
                });
            })
            return;
        case 'calendar.month.write_with_last_check':
            var days = args.days;
            var year = args.year;
            var month = args.month;
            var grp = args.grp;
            var last = args.last;

            // https://github.com/kmcguire3413/xemo/issues/7
            //
            // This is a temporary measure in order to ensure existing functionality.
            if (args.code != '0767') {
                xemo.server.dojsonerror(res, 'The code given was not correct.');
                return;
            }

            var t = db.transaction();
            // Before this transaction starts we will ensure an exclusive lock
            // on the group change log table to ensure that we are the only ones
            // that will make any changes and to prevent any rollbacks from having
            // to be performed.
            //t.locktable('grpchangelog', true);
            t.add('SELECT id, UNIX_TIMESTAMP(changed_when) AS changed_when FROM grpchangelog WHERE grpname = ? ORDER BY changed_when DESC LIMIT 1', [grp], 'r');
            t.execute(function (t) {
                if (t.results.r.rows.length > 0 && t.results.r.rows[0].changed_when > last) {
                    // The schedule has been changed since it was loaded as specified by
                    // the `last` argument. This operation should fail.
                    xemo.server.dojsonerror(res, 'The schedule was changed since you loaded the page, therefore, your changed were aborted.');
                    return;
                }
                // Create a continuation as to not release our lock.
                t = t.transaction();
                t.add(
                    'INSERT INTO grpchangelog (changed_when, grpname) VALUES (UNIX_TIMESTAMP(?), ?)',
                    [(new Date()).getTime() / 1000, grp]
                );
                for (var x = 0; x < days.length; ++x) {
                    t.add(
                        'INSERT INTO ?? (date, text) VALUES (?, ?) ON DUPLICATE KEY UPDATE text = ?',
                        [
                            'grp_' + grp, 
                            year + '/' + month + '/' + (x + 1),
                            days[x],
                            days[x],
                        ]
                    );
                }
                t.execute(function (t) {
                    if (t.total_errors > 0) {
                        xemo.server.dojsonerror(res, 'The database transaction has one or more errors.');
                        return;
                    }
                    xemo.server.dojsonres(res, 'The operation was successful.');
                    t.commit();
                });
            });
            return;
        case 'calendar.range.read_with_last':
            console.log('fetching calendar data');
            this.read_calendar(db, args, function (out, last) {
                console.log('sending calendar data', last);
                xemo.server.dojsonres(res, {
                    days:     out,
                    last:     last,
                });
            });
            return;
        case 'readcalendar' || 'calendar.range.read':
            this.read_calendar(db, args, function (out) {
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
	        case 'mp3': type = 'audio/mpeg'; break;
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
            res.writeHead(400, { 'Content-Type': 'text/plain' });
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

        if (args.op == 'personnel.get.usernames') {
            var t = db.transaction();

            t.add('SELECT username FROM personnel_auth', [], 'usernames');

            t.execute(function (t) {
                xemo.server.dojsonres(res, t.results.usernames.rows);
            });

            return;
        }

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
            value = decodeURIComponent(value);
            args[key] = value;
        }
        url = url.substring(0, url.indexOf('?'));
    }

    if (data != null) {
	/*
	    Twilio does not send POST data in JSON format. We need
	    to specially handle it here. I desire to actuall break
	    out the parameters and feed them into args, and continue,
	    but for now I am doing it this way to get it working.
	*/
	console.log('checking for alertcall');
	if (url == '/twilio_sms_request') {
	    console.log('twilio_sms_request', data);
	    var pairs = data.split('&');
	    var eargs = {};
	    for (var x = 0; x < pairs.length; ++x) {
		var parts = pairs[x].split('=');
		var k = parts[0];
		var v = parts[1];
		eargs[decodeURIComponent(k)] = decodeURIComponent(v);
	    }
	    console.log('eargs', eargs);
	    res.writeHead(200, { 'Content-Type': 'text/plain' });
	    res.end('');
	    xemo.server.alert_req_reply(state, eargs);
	    return;
	}
	if (url == '/emptyshiftcall.xml') {	
	    res.writeHead(200, { 'Content-Type': 'text/xml' });
	    res.end('<?xml version="1.0" encoding="UTF-8"?>' +
		'<Response>' +
		    '<Say voice="woman">This is the Eclectic E M S notification system. The schedule has no known driver.</Say>' +
		'</Response>'
	    );
	    return;
	}
	if (url == '/alertcall.xml') {
	    res.writeHead(200, { 'Content-Type': 'text/xml' });
	    res.end('<?xml version="1.0" encoding="UTF-8"?>' +
		'<Response>' +
		    //'<Say voice="woman">' +
			//'The Eclectic E M S personnel scheduled on the current shift has not responded to our automated' +
			//'attempt to contact them and verify that they are ready for the shift. This message is to indicate' +
			//'that there may not be a personnel who may be required for the shift the operate. You should contact' +
			//'the facility or the personnel and verify that they are on duty.' +
		    //'</Say>' +
		    '<Play loop="1">' + state.baseurl + 'missingdriver.mp3</Play>' +
		'</Response>'
	    );
	    return;
	}
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

        var method = req.method;
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

/**
 *   This contains the logic used to keep a log of who
 *   has been notified. It is powered locally by a in
 *   memory cache of recent notifications, and then backed
 *   by a database for persistence across process restarts.
 *
 *   @param {SERVER_STATE} state - server state and configuration
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
            console.log('err:' + t.results.notifylog.err);
        });
    };

    return this;
}

xemo.server.notifybysms = function (state, phonenum, message) {    
    xemo.server.notifybysms.count = xemo.server.notifybysms.count || 1;
    ++xemo.server.notifybysms.count;

    // TODO: SAFEGUARD..
    //if (xemo.server.notifybysms.count > 8) {
    //    return;
    //}

    console.log('NOTIFIED ' + phonenum);

    //return;

    var client = twilio(state.twilio_auth[0], state.twilio_auth[1]);

    /*
        We can pass a callback as the second parameter, but I opted
        to not worry about that, because to make usage of it I would
        have to track it, and the system could be prone to bugs and
        if it opted to send multiple message there is a chance that
        someone could continously get text messages and that would
        be bad.
    */

    if (state.sms_notify_fake) {
        console.log('WOULD HAVE NOTIFIED ' + phonenum);
        console.log(message);
    } else {
        console.log('@@@' + phonenum);

        for (var x = 0; x < state.twilio_debug_number.length; ++x) {
            if (state.twilio_debug_number[x] != phonenum) {
                client.sendMessage({
                    to:    state.twilio_debug_number[x],
                    from:  state.twilio_from_number,
                    body:  message
                });
            }
        }
        
        client.sendMessage({
            to:    phonenum,
            from:  state.twilio_from_number,
            body:  message
        });

        //client.sendMessage({
        //    to:    '+13346572491', //phonenum,
        //    from:  '+13345131715',
        //    body:  message
        //});
    }
}

xemo.server.alert_for_missing_shift_personnel = function (state, shift) {
    for (var x = 0; x < state.alert_numbers.length; ++x) {
        xemo.server.alert_for_missing_shift_personnel_single(state, shift, state.alert_numbers[x]);
    }
};

xemo.server.alert_for_no_shift_personnel = function (state, shift) {
    for (var x = 0; x < state.alert_numbers.length; ++x) {
	   xemo.server.alert_for_no_shift_personnel_single(state, shift, state.alert_numbers[x]);
    }    
};


xemo.server.alert_for_no_shift_personnel_single = function (state, shift, phonenum) {
    xemo.server.notifybysms(
	state,
	phonenum,
	'EMS Schedule ALERT PAGE\n' +
	'\n' +
	'ALERT FOR: ' + shift.name.toUpperCase() + '\n' +
	'\n' +
	'ACTION REQUIRED ASAP\n' + 
	'\n' + 
	'It appears that there is no personnel scheduled on duty.'
    );

    var client = twilio(state.twilio_auth[0], state.twilio_auth[1]);

    client.makeCall({
        to: phonenum, 
	from: state.twilio_from_number, /* Twilio from number. */
	/* This produces a TwiML document in XML for call instructions. */
        url: state.baseurl + 'emptyshiftcall.xml'
    }, function(err, responseData) {
        console.log('[empty-shift-call] response: ' + responseData.from); 
    });
};

xemo.server.alert_for_missing_shift_personnel_single = function (state, shift, phonenum) {
    xemo.server.notifybysms(
    	state,
    	phonenum,
    	'EMS Schedule ALERT PAGE\n' +
    	'\n' +
    	'ALERT FOR: ' + shift.name.toUpperCase() + '\n' +
    	'\n' +
    	'ACTION REQUIRED ASAP\n' + 
    	'\n' + 
    	'This personnel was flagged to respond. They are on-duty. ' +
    	'They have FAILED to respond. The shift may be uncovered.'
    );

    var client = twilio(state.twilio_auth[0], state.twilio_auth[1]);

    client.makeCall({
        to: phonenum, 
	from: state.twilio_from_number, /* Twilio from number. */
	/* This produces a TwiML document in XML for call instructions. */
        url: state.baseurl + 'alertcall.xml'
    }, function(err, responseData) {
        console.log('[alert-call] response: ' + responseData.from); 
    });
};

xemo.server.alert_req_reply = function (state, args) {
    /*
	First determine who is sending this message.
    */
    function reply(msg) {
	   xemo.server.notifybysms(state, args.From, msg); 
    }

    var t = state.db_instance.transaction();
    
    t.add(
	   'SELECT id AS pid, smsphone, firstname, middlename, lastname, surname FROM personnel WHERE smsphone = ?',
	   [args.From],
	   'r'
    );

    console.log('got SMS message from ' + args.From);

    t.execute(function (t) {
	var rows = t.results.r.rows;

	if (rows.length > 1) {
	    reply('Multiple personnel have been found matching your number. Please report this.');
	    return;
	}
	
	if (!rows || rows.length == 0) {
	    reply('No personnel on record can be associated with this number.');
	}

	if (state.is_onduty_sms_rx[rows[0].pid] != state.is_onduty_sms_tx[rows[0].pid]) {
        state.is_onduty_sms_rx[rows[0].pid] = state.is_onduty_sms_tx[rows[0].pid];
		reply('Your response has been recieved, and the system will consider you on-duty for the specified shift time.');
		
	} else {
		state.is_onduty_sms_rx[rows[0].pid] = state.is_onduty_sms_tx[rows[0].pid] + 1;
		reply('Your response has been recieved, and you will be accounted for the next shift.');
	}
	
    });
};

xemo.server.shiftnotify = function (state, group, notifytable, cb) {
    if (xemo.server.notifylog == undefined) {
        xemo.server.notifylog = new xemo.server.NotifyLog(state);
    }

    var t = state.db_instance.transaction();

    /*
	For shift notify we only need to go forward, but for shift
	alert we need to go back one day on the calendar. This is
	because the calendar days may not be split at zero hundred
	and therefore some of the current day could be on the end
	of the previous calendar day.
    */
    var sd = new Date();
    sd = new Date(sd.getFullYear(), sd.getMonth(), sd.getDate() - 1);
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

        var t = state.db_instance.transaction();
        t.add('SELECT id, firstname, middlename, lastname, surname, dateadded, smsphone, duty_alert FROM personnel', [], 'a');
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
                    smsphone:      row.smsphone,
		    duty_alert:	   row.duty_alert,
                };
            }

            var cd = new Date();

	    /*
		The shifts will be processed. Each will have a personnel ID assigned if possible. The
		shift will be checked for a need to notify the personnel. The shift will be checked for
		the need for a response from the personnel that they are on-duty for the shift.
	    */
            for (var ndx = 0; ndx < refined.length; ++ndx) {
                var shift = refined[ndx];

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
		    shift.duty_alert = pdata[shift.pid].duty_alert[0] == 0 ? false : true;
                } else {
		    shift.pid = -100;
                    /*
                        We could not resolve the personnel therefore we will make sure that we
                        let someone know that there was a problem by sending them a notification.
                    */
                    function _$a(shift, result) {
                        return function (wasnotified) {
                            if (!wasnotified) {
                                xemo.server.notifylog.logNotification(
                                    state.db_instance,
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
                                    state,
                                    state.twilio_admin_number,
                                    'EMS Schedule Admin Notification\n\n' +
                                    msg
                                );
                            }
                        };
                    }

                    xemo.server.notifylog.hasBeenNotified(
                        state.db_instance,
                        -1, shift.start.getTime() / 1000, 'SCHED_SMS_ERROR_' + group,
                        _$a(shift, result)
                    );
                }

                function _$b(shift) {
                    return function (wasnotified) {
                        if (!wasnotified) {
                            console.log('[SCHEDNOTIFY] notifying by SMSPHONE.. ' + shift.name + ':' + shift.pid + ':' + shift.start);
                            xemo.server.notifylog.logNotification(
                                state.db_instance,
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
				                state,
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

                /*
                    Compute the notification time for this shift start time,
                    and also make sure it is in the local time.
                */
                var ntime = moment.tz(shift.start, 'America/Chicago');
                var nte = notifytable[parseInt(ntime.format('HH'))];
                ntime.date(ntime.date() - 1);
                ntime.hours(nte[0]);

		/*
		    This provides the ability to validate that a personnel is on duty at
		    the shift time. To do this we need to send a message a short time before
		    the shift start, and then we will wait for a SMS reply from this personnel.

		    It will _only_ send a message inside a certain window or time, therefore, the
		    cache only needs to live for this amount of time. I am currently using ten
		    minutes. I doubt that the server will ever recieve a restart which will cause
		    this to become a problem.

		    This also can trigger about 120 minutes after the shift time. This limitation is
		    done to prevent excessive CPU consumption by this routine running in excess.
		*/
		/*
		if (cd > shift.start - (1000 * 60 * 10) && shift.duty_alert && cd.getTime() < (shift.start.getTime() + 1000 * 60 * 120)) {
		    var kr = 'R:' + new String(shift.start.getTime()) + ':' + shift.pid;
		    var ka = 'A:' + new String(shift.start.getTime()) + ':' + shift.pid;

		    console.log('hot zone for on-duty shift', shift.pid);
		    
			// Use a local short lived cache in order to prevent duplicate
			// message from being sent constantly. It is a tri-state structure.
		    if (state.is_onduty_sms_rx[shift.pid] == undefined) {
    			state.is_onduty_sms_rx[shift.pid] = 0;
    			state.is_onduty_sms_tx[shift.pid] = 0;
    			console.log('created shift.pid entry in is_onduty_sms[rx/tx]');
		    }

		    if (cd > shift.start) {
    			console.log('thinking about alert ', shift.start);
    			if (state.is_onduty_sms_rx[shift.pid] != state.is_onduty_sms_tx[shift.pid]) {
    			    console.log('trying the alert');
    				// Do alert procedure only once.
    			    if (state.is_onduty_cache_sent[ka] == undefined) {
        				console.log('doing the alert');
        				state.is_onduty_cache_sent[ka] = true;
        				xemo.server.alert_for_missing_shift_personnel(state, shift);
    			    }
    			}
		    }

		    if (cd < shift.start) {
    			if (state.is_onduty_cache_sent[kr] == undefined) {
    			    state.is_onduty_cache_sent[kr] = state.is_onduty_sms_rx;
    			    state.is_onduty_sms_tx[shift.pid]++;
    			    var delta = Math.round((shift.start.getTime() - cd.getTime()) / 1000 / 60);
    			    if (state.is_onduty_sms_tx[shift.pid] == state.is_onduty_sms_rx[shift.pid]) {
        				xemo.server.notifybysms(
        				    state,
        				    shift.smsphone,
        				    'EMS Schedule Notifcation System\n\n' +
        				    'It looks like you pre-approved yourself for the shift in ' + delta + ' minutes. Everything is OK.'
        				);
    			    } else {
        				if (shift.pid < 0) {
        				    xemo.server.alert_for_no_shift_personnel(state, shift);			
        				} else {
        				    xemo.server.notifybysms(
            				    state,
            					shift.smsphone,
            					'EMS Schedule Notification System\n' +
            					'\n' +
            					'For: ' + shift.name.toUpperCase() + '\n' +
            					'\n' +
            					'Please reply with anything to confirm that someone will be on-duty in ' + delta + ' minutes for your shift.\n\n' +
            					'A failure to reply will result in an ALERT page being transmitted.'
        				    );
        				}	
    			    }
    			}
		    }			
		}
        */
        
		/*
		    Do not worry about notifying for shifts in the past.
		*/
		if (cd > shift.start) {
		    continue;
		}

		/*
		    Kick out anything that is before the _specified_ notification time. This
		    is different from the actual shift start time and the current time.
		*/
                if (cd < ntime) {
                    continue;
                }

		/*
		    Anything below 0 has special meaning that does not concern the code below.
		*/
		if (shift.pid < 0) {
		    continue;
		}

		/*
		    Here we are actually going to do the notification.
		*/
                xemo.server.notifylog.hasBeenNotified(
                    state.db_instance,
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

xemo.server.crashLooper = function (delay, args, cb, firstcall) {
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
        console.log(err.stack);
        repeat();
    });

    var _delay = delay;    
    if (firstcall != undefined) {
        _delay = 0;
    }

    setTimeout(function () {
        notifydom.run(function () {
            process.nextTick(function () {
                console.log('crash looper started');
                cb(delay, args, repeat);
            });
        });
    }, _delay);
}

xemo.server.doNotifier = function (delay, args, repeat) {
    var trans = args.state.db_instance.transaction();

    trans.add('SELECT id, firstname, middlename, lastname, smsphone FROM personnel', [], 'a');
    trans.execute(function (t) {
        var rows = t.results.a.rows;

        for (var x = 0; x < rows.length; ++x) {
            var row = rows[x];

            var name = row.firstname + ' ' + row.middlename + ' ' + row.lastname;
            var pid = row.id;
            var smsphone = row.smsphone;

            function __b(pid, name, smsphone) {
                return function (wasnotified) {
                    if (!wasnotified) {
                        console.log('doing-initial-sms:' + smsphone + ':' + name + ':' + pid);
                        xemo.server.notifylog.logNotification(
                            state.db_instance,
                            pid,
                            0,
                            'SCHED_SMS_TEST', 0
                        );
                        xemo.server.notifybysms(
                            args.state,
                            smsphone,
                            name.toUpperCase() + ',\nIf you have recieved this message please notify Sonia so that she knows that the EMS notification system has the correct number.'
                        );
                    }
                }
            }

            if (smsphone == null) {
                continue;
            }

            xemo.server.notifylog.hasBeenNotified(
                args.state.db_instance,
                pid, 0, 'SCHED_SMS_TEST',
                __b(pid, name, smsphone)
            );
        }
    });

    /*
        The only way to ensure this process is long living
        is to release these database instances. I may be
        able create a database pool that reclaims connections
        that have been inactive for a significant time, but
        for now let us see if this works good.
    */
    xemo.server.notifylog = undefined;
    xemo.server.shiftnotify(args.state, args.group, args.notifytable, function () {
        repeat();
    });
}

xemo.server.oldSystemSync = function (delay, args, repeat) {
    var nodes = fs.readdir(args.path, function (err, nodes) {
        if (err) {
            console.log('unable to read old system path');
            repeat();
        }
        
        console.log('synced with old data');

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
                                    var t = args.state.db_instance.transaction();
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
}

xemo.server.start = function (state) {
    /*
	TODO: port everything to use a single DB connection
	TODO: have this happen before startup continues

	This makes it easy for everything to be able to access
	a valid DB connection using the state structure. At the
	moment the major systems create their own. I hope to port
	them all over to using a single connection. This also need
	to halt the startup until it completes.
    */
    dbjuggle.opendatabase(state.db, function (err, db) {
	   state.db_instance = db;
	   db.acquire();
	   xemo.server.start_L2(state);
    });
};


xemo.server.start_L2 = function (state) {    
    /*
	These are important structures for the service
	that helps to make sure that a personnel is on
	duty.
    */
    state.is_onduty_sms_rx = {};
    state.is_onduty_sms_tx = {};
    state.is_onduty_cache_sent = {};

    //if (state.sync_with_old) {
	//   xemo.server.crashLooper(1000 * 60 * 3, { state: state, path: '/home/kmcguire/www/dschedule' }, xemo.server.oldSystemSync, true);
    //}
    
    //for (var group in state.notify_for_groups) {
    //   xemo.server.crashLooper(5000, { state: state, group: group, notifytable: state.notify_for_groups[group] }, xemo.server.doNotifier);
    //}

    //xemo.server.alert_for_missing_shift_personnel(state, { name: 'TEST' });

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
    }).listen(state.http_port);

    var https_options = {
        key: state.https_key,
        cert: state.https_cert,
        ciphers: state.https_ciphers,
        honorCipherOrder: true,
    };

    https.createServer(https_options, function (req, res) {
        handle_http_request(req, res);
    }).listen(state.https_port);
};

//console.log('ebryant', CryptoJS.SHA512('ebryant:techman'));
//console.log('jprestridge', CryptoJS.SHA512('jprestridge:cashmoney'));

xemo.server.start(require(process.argv[2]));

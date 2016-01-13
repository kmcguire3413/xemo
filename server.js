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
                if (t.results.r.rows.length > 0) {
                    console.log('@@##@@', t.results.r.rows[0].changed_when, last);
                    if (t.results.r.rows[0].changed_when > last) {
                        // The schedule has been changed since it was loaded as specified by
                        // the `last` argument. This operation should fail.
                        xemo.server.dojsonerror(res, 'The schedule was changed since you loaded the page, therefore, your changed were aborted.');
                        return;
                    }
                }
                // Create a continuation as to not release our lock.
                t = t.transaction();
                t.add(
                    'INSERT INTO grpchangelog (changed_when, grpname) VALUES (NOW(), ?)',
                    [grp]
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

xemo.server.fatalRequestError = function (err, res) {
    console.log('FatalRequestError');
    console.log(res);

    if (res) {
        xemo.server.dojsonerror(res, 'FatalRequestError: ' + err.stack);
    }
    return;
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
    }).listen(state.http_port, state.http_bindhost);

    /*
    var https_options = {
        key: state.https_key,
        cert: state.https_cert,
        ciphers: state.https_ciphers,
        honorCipherOrder: true,
    };

    https.createServer(https_options, function (req, res) {
        handle_http_request(req, res);
    }).listen(state.https_port);
    */
};

xemo.server.start(require(process.argv[2] || './config.js'));

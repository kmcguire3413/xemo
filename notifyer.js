var twilio = require('twilio');
var http = require('http');
var dbjuggle = require('dbjuggle');
var core = require('./lib/core.js'); 
var moment = require('moment-timezone');

var notifyer = {};

notifyer.test_if_notified = function (pid, notifiedfor_unixtime, system, cb) {
	var trans = this.db.transaction();
	trans.add('SELECT id, UNIX_TIMESTAMP(notifiedon) AS notifiedon, state FROM notifylog2 WHERE pid = ? AND UNIX_TIMESTAMP(notifiedfor) = ? AND system = ?', [pid, notifiedfor_unixtime, system], 'notifylog');
	trans.execute(function (t) {
		if (t.results && t.results.notifylog && t.results.notifylog.rows && t.results.notifylog.rows.length > 0) {
			cb(true, t.results.notifylog.rows[0].state, new Date(t.results.notifylog.rows[0].notifiedon * 1000));
		} else {
			cb(false, null);
		}
	});
};

notifyer.set_as_notified = function (pid, notifiedfor_unixtime, system, state, cb) {
	var trans = this.db.transaction();
	if (state == undefined) {
		state = 0;
	}
	trans.add(
		'INSERT INTO notifylog2 (pid, notifiedon, notifiedfor, system, state) VALUES (?, NOW(), FROM_UNIXTIME(?), ?, ?)',
		[pid, notifiedfor_unixtime, system, state]
	);
	trans.execute(function (t) {
		t.commit();
		if (cb) {
			cb();
		}
	});
};

notifyer.test_if_new = function (prec) {
	var self = this;

	this.test_if_notified(prec.id, 0, 'SCHED_SMS_TEST', function (test_good) {
		if (!test_good) {
			if (prec.smsphone != null) {
				notifyer.sms_send(
					prec.smsphone, 
					'This number has been added to the EMS notification system under ' +
					'the name, ' + prec.fullname + '.'
				);
				self.set_as_notified(prec.id, 0, 'SCHED_SMS_TEST');
			}
		}
	});
};

notifyer.abort = function (msg) {
	this.sms_admin('The system has been shutdown automatically as a protection measure. It encountered an error reported as follows:\n\n' + msg);
	this.makecall_admin('The system has been shutdown automatically as a protection measure. It encountered an error. Check your SMS messages.');
	this.makecall = function () { };
	this.sms_send = function () { };
	setTimeout(function () {
		process.exit();
	}, 30000);
};


notifyer.makecall_admin = function (say) {
	//for (var x = 0; x < this.cfg.notifyer_admin_numbers.length; ++x) {
	this.makecall('+13345807300', say);
	//}
};


notifyer.makecall = function (tophone, say, cb) {


	console.log('call', tophone, say);

	var self = this;
    var client = twilio(this.cfg.twilio_auth[0], this.cfg.twilio_auth[1]);

    // Hopefully, this serves as a fairly safe method no matter
    // what code some other place does to produce a unique number.
    this.calldata_next_id = this.calldata_next_id + 1;
    var calldataid = this.calldata_next_id;
    this.calldata_next_id = this.calldata_next_id + 1;

    this.calldata[this.calldataid] = 
        '<?xml version="1.0" encoding="UTF-8"?><Response><Pause length="2"/><Say>' + say + '</Say></Response>';

    client.makeCall({
        to:       tophone, 
		from:     this.cfg.twilio_from_number,
        url: 	  this.cur_baseurl + 'calldata?id=' + calldataid
    }, function(err, responseData) {
    	if (err) {
    		if (cb) {
    			cb(false);
    		}
    	} else {
    		if (cb) {
    			cb(true);
    		}
    	}
    });
};

notifyer.sms_send = function (tophone, msg) {
	var client = twilio(this.cfg.twilio_auth[0], this.cfg.twilio_auth[1]);
    client.sendMessage({
        to:    tophone,
        from:  this.cfg.twilio_from_number,
        body:  msg
    });

	console.log('sms', tophone, msg);
};

notifyer.sms_admin = function (msg) {
	for (var x = 0; x < this.cfg.notifyer_admin_numbers.length; ++x) {
		this.sms_send(this.cfg.notifyer_admin_numbers[x], msg);
	}
};

notifyer.sms_personnel = function (pdata, msg) {
	this.sms_send(pdata.smsphone, msg);
};

notifyer.fetch_schedule = function (sd, ed, group, cb) {
	var trans = this.db.transaction();
	trans.add(
		'SELECT YEAR(date) AS year, MONTH(date) AS month, DAYOFMONTH(date) AS day, text FROM ?? WHERE date >= FROM_UNIXTIME(?) AND date < FROM_UNIXTIME(?) ORDER BY date',
		[
			'grp_' + group,
			sd.getTime() / 1000,
			ed.getTime() / 1000
		],
		'a'
	);
	trans.execute(function (t) {
		var rows = t.results.a.rows;
		var out = [];

		for (var x = 0; x < rows.length; ++x) {
			var row = rows[x];
			out.push({
				year: 		parseInt(row.year),
				month:      parseInt(row.month),
				day:        parseInt(row.day),
				text:       row.text
			});
		}

		var refined = [];

		for (var i = 0; i < out.length; ++i) {
			var entry = out[i];
			var lines = entry.text.split('\n');
			core.textcalendar.parseLinesIntoShifts(lines, function (name, start, end) {
				var shift = core.textcalendar.makeRoughShift(entry.year, entry.month, entry.day, name, start, end);
				shift.group = group;
				refined.push(shift);
			});
		}

		core.textcalendar.refineRoughShifts(refined, function (year, month, day, hour, minute) {
            return new Date(moment.tz({
                year:    year,
                month:   month,
                day:     day,
                hour:    hour,
                minute:  minute
            }, 'America/Chicago'));				
		});

		cb(refined);
	});
};

notifyer.sms_send_shift_conditional = function (shift, notifiedfor_unix, sys, msg) {
	var self = this;
	this.test_if_notified(shift.pid, notifiedfor_unix, sys, function (test_good) {
		if (!test_good) {
			if (shift.smsphone != null) {
				self.set_as_notified(shift.pid, notifiedfor_unix, sys);
				self.sms_personnel(
                    shift.pdata, msg
                );
			}
		}
	});	
};

notifyer.consider_notifying_for_shift = function (shift) {
	var self = this;

	var local_start = moment.tz(shift.start, 'America/Chicago');

	var delta_until = (shift.start.getTime() - this.cur_date().getTime()) / 1000 / 60 / 60;

	if (!shift.smsphone) {
		return;
	}

	// This is an extra message for John Estes as he stated that he wanted one.
	if (delta_until <= 2 && shift.pid == 5) {
		this.sms_send_shift_conditional(shift, shift.start.getTime() / 1000, 'SCHED_SMS_EXTRA39232_' + shift.group, 
            'EMS Schedule Notification System\n' +
            '\n' +
            'EXTRA REMINDER MESSAGE\n' +
            '\n' +
            'For: ' + shift.name.toUpperCase() + '\n' +
            '\n' +
            'YOU are scheduled ON DUTY for ' + shift.group.toUpperCase() + ' on ' +
            local_start.format('MMM, Do') + ' at ' + local_start.format('HH:mm') + '\n'
		);
	}

	this.test_if_notified(shift.pid, shift.start.getTime() / 1000, 'SCHED_SMS_' + shift.group, function (test_good) {
		if (!test_good) {
			self.set_as_notified(shift.pid, shift.start.getTime() / 1000, 'SCHED_SMS_' + shift.group);
			self.sms_personnel(
                shift.pdata, 
                'EMS Schedule Notification System\n' +
                '\n' +
                'REPLY WITH _ANY_ TEXT MESSAGE TO ACKNOWLEDGE!\n' +
                '\n' +
                'For: ' + shift.name.toUpperCase() + '\n' +
                '\n' +
                'YOU are scheduled ON DUTY for ' + shift.group.toUpperCase() + ' on ' +
                local_start.format('MMM, Do') + ' at ' + local_start.format('HH:mm') + '\n'
            );
		}
	});	
};

notifyer.fetch_sms_recv = function (start, phonenum, cb) {
	var trans = this.db.transaction();
	trans.add(
		'SELECT recvon, message FROM sms_recv WHERE recvon > UNIX_TIMESTAMP(?) AND fromphone = ? ORDER BY id',
		[start.getTime() / 1000, phonenum],
		'r'
	);
	trans.execute(function (t) {
		var rows = t.results.r.rows;
		if (rows) {
			cb(rows);
		} else {
			cb([]);
		}
	});
};

notifyer.cur_date = function () {
	if (this.date_override) {
		return this.date_override;
	}

	return new Date();
};

notifyer.get_alert_level = function (shift, notifiedon) {
	var cd = this.cur_date();
	var hours_since = (cd.getTime() - notifiedon.getTime()) / 1000 / 60 / 60;
	var hours_until = (shift.start - cd.getTime()) / 1000 / 60 / 60;
	if (hours_since < 2) {
		// At least give them an hour to respond. If the situation has become
		// this dire then surely the person making these changes has talked
		// directly to the personnel so lets just ignore it.
		return null;
	}
	if (hours_until <= 0.5) {
		return [3, hours_until, 'DANGER']
	}
	//if (hours_until <= 2) {
	//	return [2, hours_until, 'WARNING'];
	//}
	if (hours_since > 12) {
		return [1, hours_until, 'CAUTION'];
	}
	if (hours_since > 6) {
		return [0, hours_until, 'NOTICE'];
	}
	return null;
};

notifyer.consider_admin_shift_problem_alert = function (shift, problem) {
	var self = this;
	var sys = 'SCHED_SMS_PROBLEM_' + shift.group;

	self.test_if_notified(shift.pid, shift.start.getTime() / 1000, sys, function (test_good) {
		if (!test_good) {
			console.log('doing');
			self.set_as_notified(shift.pid, shift.start.getTime() / 1000, sys);
			self.sms_admin(problem);
		}
	});
};

notifyer.consider_admin_response_alert = function (shift) {
	var self = this;

	var sys = 'SCHED_SMS_' + shift.group;
	self.test_if_notified(shift.pid, shift.start.getTime() / 1000, sys, function (test_good, state, notifiedon) {
		self.fetch_sms_recv(shift.start, shift.smsphone, function (msgs) {
			if (msgs.length == 0) {
				// Only do this if we can say with high reliability that
				// we have appeared to have successfully sent a SMS message
				// to this personnel.
				//
				// Unless the shift has no known personnel. This will let
				// us treat this as a message that needs to be constantly
				// repeated at different times.
				if (!notifiedon && shift.name != '<nobody>') {
					return;
				}

				if (!notifiedon) {
					notifiedon = new Date(0);
				}

				//var alert_level = self.get_alert_level(shift.start);
				var alert_level = self.get_alert_level(shift, notifiedon);

				if (alert_level == null) {
					// There is no need to alert. No alert level was
					// returned.
					return;
				}

				alert_level[1] = Math.round(alert_level[1]);

				var sys = 'SCHED_SMS_ALERT_' + alert_level[0] + '_' + shift.group;

				self.test_if_notified(shift.pid, shift.start.getTime() / 1000, sys, function (test_good) {
					if (!test_good) {
						self.set_as_notified(shift.pid, shift.start.getTime() / 1000, sys);

						var local_start_disp = moment.tz(shift.start, 'America/Chicago').format('MMM, Do HH:mm');

						if (alert_level[0] == 3) {
							self.makecall_admin('The eclectic schedule system shows that a shift that is to start in the hour has not been confirmed for ' + shift.pdata.fullname + ' on ' + local_start_disp + '.');
						}

						var problem = '';
						if (shift.problem) {
							self.sms_admin(
								alert_level[2] + ': ' + alert_level[1] + ' HOURS UNTIL SHIFT START\n' +
								'\n' +
								'The shift ' + moment.tz(shift.start, 'America/Chicago').format('MMM, Do HH:mm') + ' has a problem detailed below:\n\n' +
								problem
							);
						} else {
							self.sms_admin(
								alert_level[2] + ': ' + alert_level[1] + ' HOURS UNTIL SHIFT START\n' +
								'\n' +
								'The personnel, ' + (shift.pdata ? shift.pdata.fullname : '<error>') + ', has not responded for the shift ' + moment.tz(shift.start, 'America/Chicago').format('MMM, Do HH:mm') + '.\n' +
								'\n' +
								'To override reply with @ack:' + shift.pid
							);
						}
					}
				});
			}
		});
	});
};

notifyer.check_sched = function () {
	var self = this;

    var sd = this.cur_date();
    sd = new Date(sd.getFullYear(), sd.getMonth(), sd.getDate() - 1);
    var ed = this.cur_date();
    ed = new Date(ed.getFullYear(), ed.getMonth(), ed.getDate());
    ed.setDate(ed.getDate() + 2);

    var group = 'driver';

    this.get_pdata(function (pdata) {
		self.fetch_schedule(sd, ed, group, function (sched) {
			var cd = self.cur_date();

			for (var x = 0; x < sched.length; ++x) {
				var shift = sched[x];

				if (shift.name.indexOf('?') > -1) {
					console.log('ignored shift ', shift.start);
					continue;
				}

				var error = self.assign_pid_to_shift(pdata, shift);

				var local_start = moment.tz(shift.start, 'America/Chicago');
				var local_end = moment.tz(shift.start, 'America/Chicago');

				if (cd > shift.start) {
					continue;
				}

				// Get the time to send the notification to the personnel.
                var ntime = moment.tz(shift.start, 'America/Chicago');
                var nte = self.cfg.notify_for_groups[group][parseInt(ntime.format('HH'))];
                ntime.date(ntime.date() - 1);
                ntime.hours(nte[0]);

                // How close is the next shift?
                var hours_delta = (shift.start.getTime() - cd.getTime()) / 1000 / 60 / 60;

                var problem = null;

				if (shift.name == '<nobody>') {
					error = null;
					problem = 
						'Shift: ' + local_start.format('MMM, Do HH:mm') + '\n' +
						'\nThere is nobody assigned on upcoming shift. To ignore this place a question mark in the name portion on the schedule.\n\n' +
						'This is to help not forget. As the shift approaches a message will be sent a few more times and finally a phone call should happen.';
				}

				if (error != null) {
					problem =
                        'The name "' + shift.name + '" could not be matched to a personnel.\n\n' +
                        'Unable to determine phone number.\n\n' +
                        'Error was:\n' + error + '\n\n' +
                        'Shift: ' + local_start.format('MMM, Do HH:mm') + '\n' +
                        '\n' +
                        'Edit schedule to resolve name conflict.'
                    ;
				}

				if (problem) {
					self.consider_admin_shift_problem_alert(shift, problem);
				}

				shift.problem = problem;

				// Consider notifying personnel. This will likely get called many
				// times before `cd > shift.start == true`, therefore, this function
				// must do what it must in regards to the fact.
				if (cd >= ntime) {
                	self.consider_notifying_for_shift(shift);
                	self.consider_admin_response_alert(shift);
                }
			}

			console.log('processed ' + sched.length + ' schedule entries');
		});
	});
};

notifyer.get_pdata = function (cb) {
	var trans = this.db.transaction();
	trans.add('SELECT id, firstname, middlename, lastname, surname, dateadded, smsphone, duty_alert FROM personnel', [], 'a');
	trans.execute(function (t) {
		var out = t.results.a.rows;
		var pdata = {};
		for (var x = 0; x < out.length; ++x) {
			var row = out[x];
			pdata[row.id] = {
				firstname:        row.firstname,
				middlename:       row.middlename,
				lastname:         row.lastname,
				surname:          row.surname,
				dateadded:        row.dateadded,
				smsphone:         row.smsphone,
				fullname:         row.firstname + ' ' + row.middlename + ' ' + row.lastname + ' ' + row.surname, 
				duty_alert:       row.duty_alert,
			};
		}

		cb(pdata);
	});
};

notifyer.assign_pid_to_shift = function (pdata, shift) {
	var result = core.getPersonnelIDFromName(pdata, shift.name, shift.start);
	if (result[0] == 1) {
		shift.pid = result[1];
		shift.smsphone = pdata[result[1]].smsphone;
		shift.pdata = pdata[result[1]];
		return null;
	} else {
		shift.pid = -100;
		switch (result[0]) {
			case -1:
				return 'multiple matches: ' + result[1].join(', ');
			case 0:
				return 'could not be matched with any personnel';
			default:
				return 'unknown error (report this)'
		}
	}
};

notifyer.check_new = function () {
	var self = this;
	var trans = this.db.transaction();
	trans.add('SELECT id, firstname, middlename, lastname, surname, smsphone FROM personnel', [], 'a');
	trans.execute(function (t) {
		var rows = t.results.a.rows;
		for (var x = 0; x < rows.length; ++x) {
			rows[x].fullname = rows[x].firstname + ' ' + rows[x].middlename + ' ' + rows[x].lastname + ' ' + rows[x].surname;
			self.test_if_new(rows[x]);
		}
	});
};

notifyer.http_request = function (req, res, params, url) {
	var self = this;

	// url: 	  this.cur_baseurl + 'calldata?id=' + calldataid
	if (url == '/calldata') {
		var calldataid = params.calldataid;

		if (this.calldata[calldataid] == undefined) {
			res.writeHead(404, {'Content-Type': 'text/xml'});
			res.end('');
		} else {
			res.writeHead(200, {'Content-Type': 'text/xml'});
			res.end(this.calldata[calldataid]);
			// TODO: delete this entry after some time (6 hours)
		}
		return;
	}

	var from = params.From;
	var body = params.Body || '';
	var to = params.To;

	console.log(params);

	res.writeHead(200, {'Content-Type': 'text/plain'});

	var self = this;

	if (body.indexOf('@ack:') == 0) {
		var o_from = from;
		var pid;
		try {
			pid = parseInt(body.substring(5));
			var t = this.db.transaction();
			t.add('SELECT firstname, lastname, smsphone FROM personnel WHERE id = ?', [pid], 'r');
			t.add('SELECT firstname, lastname FROM personnel WHERE smsphone = ?', [from], 'x');
			t.execute(function (t) {
				if (t.results.r.rows.length < 1) {
					res.end('The personnel with ID ' + pid + ' could not be found. Check the ID.');
					return;
				}
				if (t.results.x.rows.length < 1) {
					res.end('You are not authorized to execute this command.');
					return;
				}
				var fullname = t.results.r.rows[0].firstname + ' ' + t.results.r.rows[0].lastname;
				var smsphone = t.results.r.rows[0];
				var adminname = t.results.x.rows[0].firstname + ' ' + t.results.x.rows[0].lastname;

				t = self.db.transaction();
				t.add(
					'INSERT INTO sms_recv (fromphone, tophone, message, recvon) VALUES (?, ?, ?, NOW())',
					[smsphone, to, '@admin-override[' + from + ']']
				);

				self.sms_admin('Acknowledgement override for ' + fullname + ' successful from ' + adminname + '.');

				t.execute(function (t) {
					t.commit();
				});
			});
		} catch (err) {
			res.end('The ID "' + body.substring(5) + '" could not be understood as a number.');
		}
	} else {
		res.end('Your response was interpreted as acceptance and acknowledgement of this shift. If this is incorrect then contact someone.');
	}
};

notifyer.start = function (cfg) {
	var self = this;

	this.calldata = {};
	this.calldata_next_id = Math.floor(Math.random() * 100000);

	this.cfg = cfg;

	dbjuggle.opendatabase(cfg.db, function (err, db) {
		self.db = db;
		console.log('database opened');
		db.acquire();
		setInterval(function () {
			self.check_new();
			self.check_sched();
		}, 1000 * 3);
		console.log('notifyer interval started');
	});

	//this.date_override = new Date();
	//this.date_override.setDate(this.date_override.getDate() - 4);
	//setInterval(function () {
	//	self.date_override.setTime(self.date_override.getTime() + 1000 * 60 * 60);
	//	console.log('TIME IS NOW ' + self.date_override);
	//}, 3000);

	http.createServer(function (req, res) {
		function decode_args(strg) {
	        var _args = strg.split('&');
	        var args = {};
	        for (var x = 0; x < _args.length; ++x) {
	            var pair = _args[x].split('=');
	            var key = pair[0];
	            var value = pair[1];
	            value = decodeURIComponent(value);
	            args[key] = value;
	        }
	        return args;
		}
		function __NL(req, res, data) {
		    var url_args = {};
		    var post_args = {};
		    var url = req.url;
		    if (url.indexOf('?') > -1) {
		        var url_end = url.substring(url.indexOf('?') + 1);
		        url = url.substring(0, url.indexOf('?'));
		        url_args = decode_args(url_end);
		    } else {
		    	url_args = {};
		    }
		    if (data) {
		    	data_args = decode_args(data);
		    } else {
		    	data_args = {};
		    }
		   	var args = {};
		   	for (var k in url_args) {
		   		args[k] = url_args[k];
		   	}
		   	for (var k in data_args) {
		   		args[k] = data_args[k];
		   	}
		   	self.http_request(req, res, args, url);
		   	return 
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
            	__NL(req, res, data.join(''));
            });
            return;
        }		
        __NL(req, res, null);
	}).listen(cfg.notifyer_http_port);

	this.cur_baseurl = 'http://' + this.cfg.notifyer_host + ':' + this.cfg.notifyer_http_port + '/';
};

notifyer.start(require(process.argv[2]));
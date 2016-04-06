var dbjuggle = require('dbjuggle');
var twilio = require('twilio');

function sms_send(cfg, tophone, msg) {
	var client = twilio(cfg.twilio_auth[0], cfg.twilio_auth[1]);
    client.sendMessage({
        to:    tophone,
        from:  this.cfg.twilio_from_number,
        body:  msg
    });

	console.log('sms', tophone, msg);
};


function notifyer_watchdog_start(cfg) {
	var deduct = 0;
	var cfg_limit = 12;
	var limit = 12;
	setInterval(function () {
		dbjuggle.opendatabase(cfg.db, function (err, db) {
			var trans = db.transaction();
			trans.add('SELECT UNIX_TIMESTAMP(notifiedon) AS notifiedon FROM notifylog2 ORDER BY notifiedon DESC LIMIT 1', [], 'r');
			trans.execute(function (t) {
				var rows = t.results.r.rows;
				var largest = 0;

				for (var x = 0; x < rows.length; ++x) {
					if (rows[x].notifiedon > largest) {
						largest = rows[x].notifiedon;
					}
				}

				var ct = (new Date()).getTime() / 1000.0;
				var delta = (ct - largest) / 60 / 60;

				// If we drop below our limit then we shall reset the deduct.
				if (delta < limit) {
					deduct = 0;
					limit = cfg_limit;
					console.log('reset limit');
				}

				// Each time we exceed the limit re-set deduct and alter the limit.
				if (delta - deduct > limit) {
					limit = 1;
					deduct = delta;
					console.log('alerting');
					var msg = '';
					try {
						msg = 'The EMS notification system may have stopped running. There has been no new notifications for at least ' + cfg_limit + ' hours.';
					} catch (err) {
						msg = 'The EMS notification system may have stopped running.';
					}
					try {
						//sms_send(cfg, '+13345807300', 'The EMS notification system may have stopped running.');
					} catch (err) {

					}
					try {
						//sms_send(cfg, '+13346572491', 'The EMS notification system may have stopped running. There');
					} catch (err) {

					}
				}
			});
		});
	}, 60000 * 5);
}

notifyer_watchdog_start(require(process.argv[2]));
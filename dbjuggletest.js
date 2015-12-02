var dbjuggle = require('dbjuggle');

var app = {};
var mylib = {};

mylib.dosomething = function (db, cb) {
	var t = db.transaction();
	t.add('SELECT a FROM test', [], 'r');
	t.execute(function (t) {
		cb(t.results.r.rows);
	});	
};

var g_db = null;

function fail(id) {
	console.log('TEST FAILED (' + id + ')');
	process.exit();
}

function pass(id) {
	console.log('TEST PASSED (' + id + ')');
}

function app_test1() {
	var t = g_db.transaction();
	t.add('SELECT * FROM test');
	t.execute(function (t) {
		if (t.error_count < 1) {
			fail('2-select from created table without commit');
		}
		var t = g_db.transaction();
		t.add('CREATE TABLE test (a bigint primary key auto_increment, b int)');
		t.execute(function (t) {
			t.commit();

			// Try intertwining two transactions where one will continue.
			var t0 = g_db.transaction();
			var t1 = g_db.transaction();

			t0.add('INSERT INTO test (a, b) VALUES (0, 1)');
			t1.add('INSERT INTO test (a, b) VALUES (0, 1)');

			var has_run = false;

			t0.execute(function (t) {
				if (has_run) {
					fail('3.1-dual');
				}
				var t2 = t.transaction();
				t2.add('DELETE FROM test WHERE a = 0');
				t2.execute(function (t) {
					t.commit();
					has_run = true;
				});
			});

			t1.execute(function (t) {
				if (!has_run) {
					fail('3.2-dual');
				}
				pass('3');
			});
		});
	});
}

function app_main() {
	var t = g_db.transaction();
	t.add('DROP TABLE test');
	t.execute(function (t) {
		t.commit();
		t = g_db.transaction();
		t.add('SELECT * FROM test');
		t.execute(function (t) {
			if (t.error_count < 1) {
				fail('1-select from non-existant table')
				process.exit();
			}
			console.log('TEST1 PASSED');
			t = g_db.transaction();
			//t.add('CREATE TABLE test (a bigint primary key auto_increment, b int)');
			t.execute(function (t) {
				app_test1();
			});
		});
	});
};


dbjuggle.opendatabase({
    type:     'mysql',
    host:     '127.0.0.1',
    dbname:   'hurt',
    user:     'hurt',
    pass:     'kxmj48dhxnzhsDxnMXJS3l'
}, function (err, db) {
	g_db = db;
	g_db.acquire();
	app_main();
});


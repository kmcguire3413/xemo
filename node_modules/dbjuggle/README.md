DbJuggle
==========

A small library that provides connection pooling, acquisition, and release for
databases that support or can emulate transactions. It makes managing a connection
pool easier and the release of connections.

_It does not provide SQL compatibility between databases._

## Notes
	
I only need to add a small stub for sqlite3 to complete support. Also, this module
is very new and may contain bugs.

## Built-In Database Support

	MySQL - working
	sqlite3 - disabled 
	          (working, but missing some release code)

## Installation

	npm install dbjuggle

## Usage

	const dbjuggle = require('dbjuggle');

	dbjuggle.opendatabase({
        type:     'mysql',
        host:     'localhost',
        dbname:   'mydatabase',
        user:     'myuser',
        pass:     'mypassword'
	}, function (err, dbconn) {
		var trans = dbconn.transaction();
		trans.add(
			'SELECT id, name, age FROM personnel WHERE id > ? AND age > ?', 
			[10, 20], 
			'keya'
		);
		trans.add(
			'SELECT name FROM books WHERE author = ?', 
			['Somebody'], 
			'whatever'
		);
		/*
			This will increment the reference count for the connection.

			The call is nested between a try and catch block to help decrement the 
			reference count if an error occures.
		*/
		trans.execute(function (trans_ref_copy) {
			if (trans_ref_copy.results.keya.err || trans_ref_copy.results.whatever.err) {
				/* The transactions encountered an error. */
				return;
			}

			var keya = trans_ref_copy.results.keya.rows;
			var whatever = trans_ref_copy.results.whatever.rows;

			for (var x = 0; x < keya.length; ++x) {
				var id = keya[x].id;
				var name = keya[x].name;
				var age = keya[x].age;
			}
			var another_trans = dbconn.transaction();
			/*
				.... make another transaction ...

				This transaction will actually execute after our current
				transaction finishes since they are on the same connection.

				If you would like to get a transaction that will run right now 
				or as soon as possible then grab another database connection 
				like below.
			*/
			dbconn.dup(function (err, anotherconn) {
				/*
					This execution may be delayed if no connection exists in
					the pool and depending on the implementation of the 
					specific database.
				*/
				var trans_on_another_conn = anotherconn.transaction();
			});


			/*
				We might like to commit or rollback?

				A rollback automatically happens when the callback exits, unless
				you called commit, or a commit happens if you provided no callback.
			*/
			if (something) {
				trans_ref_copy.commit();
			} else {
				trans_ref_copy.rollback();
			}

			/*
				This is the only tricky place. If you call something that 
				becomes asynchronous and it holds a reference to `dbconn` 
				then it may throw an error because once `dbconn` has been 
				released all methods throw errors. This is beneficial but can
				cause errors so BEWARE, luckily at least you will know...
				.. eventually.
			*/
			dbconn.acquire();
			my_other_function_with_an_async_callback(function () {
				/* Notice that we called `dbconn.acquire` above.
				dbconn.transaction();
				/* Notice we have to do a manual release call here. */
				dbconn.release();
			});

			/* 
				The connection reference count is decremented when this 
				function exits, and if the reference count is zero then it is 
				released back to the pool if a pool is implemented and 
				supported.
			*/			
		});
		/*
			If reference count is zero the connection would be released here.
			But... its not going to be if we called trans.execute above.
		*/
	});

## Domains

You may wish to wrap your code using the `domain` module, see `require('domain')` which can
provide the ability to release the connection using `dbconn.release_all()` which will decrement
the reference count to zero and make the reference to the connection unusable. Although the
actualy connection will be recycled and placed back into the pool (if pools are supported).
const https = require('https');
const http = require('http');
const fs = require('fs');
const sqlite3 = require('sqlite3');
const crypto = require('crypto');

var xemo = {};
xemo.server = {};

xemo.server.options = {
    key: fs.readFileSync('/home/www-data/key.pem'),
    cert: fs.readFileSync('/home/www-data/cerm.prem'),
    ciphers: 'ECDHE-RSA-AES128-SHA256:DHE-RSA-AES128-SHA256',
    honorCipherOrder: true,
    passphrase: 'tty5413413'
};

xemo.server.sqlexecute = function (db, statements, exclusivelock) {

}

xemo.server.opendatabase = function (state) {
    var db = state.db;

    switch (db.type) {
        case 'sqlite3':
            var dbi = {};
            dbi.db = db;
            dbi.pending = [];
            dbi.pending_lock = false;

            dbi.instance = new sqlite3.Database(db.path);

            dbi.process_pending = function (clearlock) {
                if (clearlock) {
                    // We have finished a transaction, and
                    // we need to clear the lock and execute
                    // any other pending transactions.
                    this.pending_lock = false;
                }

                if (this.pending_lock) {
                    // We are in the middle of executing
                    // another transaction.
                    return;
                }

                if (this.pending.length < 1) {
                    // There is nothing left that
                    // is current pending.
                    return;
                }
                this.pending_lock = true;
                var next = this.pending.pop();
                next.__execute(next.cb);
            }

            dbi.transaction = function () {
                var r = { 
                    dbi:      dbi,
                    stmts:    [],
                    results:  {},
                    done:     false,
                    executed: false,
                    pending:  0,
                    commited: false,
                    locktable: function(table) {
                        if (this.executed) {
                            throw new Error('This statement has already been executed');
                        }                        
                        // For sqlite3 it does not support single table locking, so we
                        // just lock the entire database.
                        this.addquery('BEGIN EXCLUSIVE TRANSACTION');
                    },
                    add: function (sqlstmt, params, key) {
                        if (this.executed) {
                            throw new Error('This statement has already been executed');
                        }
                        this.stmts.push({
                            sqlstmt:    sqlstmt, 
                            params:     params,
                            resultkey:  key
                        });
                    },
                    execute: function (cb) {
                        if (this.executed) {
                            throw new Error('This statement has already been executed');
                        }                        
                        // (1) Store the callback.
                        // (2) Add us to pending.
                        // (3) Process the pending queue.
                        this.executed = true;
                        this.cb = cb;
                        this.dbi.pending.push(this);
                        this.dbi.process_pending(false);
                    },
                    __docb: function (cb) {
                        this.done = false;
                        if (cb == true || cb == undefined) {
                            // If no callback specified, OR the callback
                            // was set to true, then auto-commit the
                            // transaction.
                            return this.commit();
                        }
                        console.log('calling callback');
                        var r = cb(this);
                        console.log('done with callback');
                        // If callback used we only commit if it returned
                        // true and it has not already called commit or
                        // rollback.
                        if (r && !this.done) {
                            this.commit();
                        }
                        if (!r && !this.done) {
                            this.rollback();
                        }
                        return this.commited;
                    },  
                    __execute: function (cb) {
                        var self = this;
                        console.log('__execute()');
                        this.dbi.instance.serialize(function (){
                            self.pending = self.stmts.length;
                            self.dbi.instance.run('BEGIN');
                            for (var x = 0; x < self.stmts.length; ++x) {
                                var stmt = self.stmts[x];
                                if (stmt.params != undefined) {
                                    for (var k in stmt.params) {
                                        var re = new RegExp('{' + k + '}', 'g');
                                        stmt = stmt.replace(re);
                                    }
                                }
                                if (stmt.resultkey == undefined) {
                                    self.dbi.instance.run(stmt.sqlstmt, stmt.params);
                                    --pending;
                                } else {
                                    var rkey = self.stmts[x].resultkey;
                                    self.dbi.instance.all(stmt.sqlstmt, stmt.params, function (err, rows) {
                                        --self.pending;
                                        self.results[rkey] = {
                                            err:         err,
                                            rows:        rows
                                        };
                                        if (self.pending == 0) {
                                            // If we could start another transaction..
                                            // self.dbi.process_pending();
                                            self.__docb(cb);
                                        }
                                    });
                                }
                            }

                            if (self.pending == 0) {
                                // If we could start another transaction..
                                // self.dbi.process_pending();
                                self.__docb(cb);
                            }
                        });
                    },
                    rollback: function () {                
                        if (this.done) {
                            return false;
                        }
                        this.dbi.instance.run('ROLLBACK');
                        this.commited = false;
                        this.done = true;
                        this.dbi.process_pending(true);
                        return false;
                    },
                    commit: function() {      
                        if (this.done) {
                            return false;
                        }
                        this.dbi.instance.run('COMMIT');
                        this.commited = true;
                        this.done = true;
                        console.log('commited');
                        this.dbi.process_pending(true);
                        return true;
                    },
                };
                return r;
            }

            return dbi;
        default:
            throw new Error('The database type was not supported.');
    }
}

xemo.server.handlerL3 = function (state, req, res, args, user) {
    switch (args.op) {
        // verify                   verify.cred
        case 'verify.cred':
            xemo.server.dojsonres(res, {
                perm:      user.canwrite ? 1 : 0,
                username:  user.username,
                id:        user.id
            });
            return;            
        // commitPersonnel          personnel.commit
        case 'commitPersonnel' || 'personnel.commit':
        // getAllPersonnel          personnel.all.get
        case 'getAllPersonnel' || 'personnel.all.get':
        // enum_years               calendar.enum.years
        case 'enum_years' || 'calendar.enum.years':
        // enum_months              calendar.enum.months
        case 'enum_months' || 'calendar.enum.months':
        // dayunlock                calendar.lock.release
        case 'dayunlock' || 'calendar.day.lock.release':
        // daylock                  calendar.lock.acquire
        case 'daylock' || 'calendar.day.lock.acquire':
        // dayread                  calendar.day.read
        case 'dayread' || 'calendar.day.read':
        // daywrite                 calendar.day.write
        case 'daywrite' || 'calendar.day.write':
        // readcalendar             calendar.range.read
        case 'readcalendar' || 'calendar.range.read':
        // readcalls                events.range.read
        case 'readcalls' || 'events.range.read':
        // get_personel_attributes  personnel.attributes.get
        case 'get_personel_attributes' || 'personnel.attributes.get':
        // getpaysysinfo            paysystem.all.get
        case 'getpaysysinfo' || 'paysystem.all.get':
        // gen_document             document.generate
        case 'gen_document' || 'document.generate':
        // get_personnel_names      personnel.names.fromids
        case 'get_personnel_names' || 'personnel.names.fromids':
        // get_personnel_data       personnel.all.get
        case 'get_personnel_data' || 'personnel.all.get':
        // get_personnel_ids        personnel.ids.fromnames
        case 'get_personnel_ids' || 'personnel.ids.fromnames':
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('hello world');
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
    xemo.server.doresponse(res, 'text/json', JSON.stringify(data));
}

xemo.server.dojsonerror = function (res, message) {
    var data = {
        code:   'error',
        error:  message 
    };
    xemo.server.doresponse(res, 'text/json', JSON.stringify(data));
}

xemo.server.handlerL2 = function (state, req, res, args) {
    const url = req.url;

    const db = xemo.server.opendatabase(state);

    var t = db.transaction();
    t.add('SELECT id, username FROM personnel_auth WHERE hash = ?', [args.key], 'a');
    t.execute(function (reply) {
        if (reply.results.a.rows.length == 0) {
            xemo.server.dojsonerror(res, 'The username and password were rejected.');
            return;
        }        
        var user = {
            id:         reply.results.a.rows[0].id,
            username:   reply.results.a.rows[0].username
        };
        var t = db.transaction();
        t.add('SELECT canwrite FROM personnel_perm_rw WHERE id = ?', [user.id], 'a');
        t.execute(function (reply) {
            if (reply.results.a.rows.length == 0) {
                xemo.server.dojsonerror(res, 'The user has no permissions set in the database.');
                return;
            }
            if (reply.results.a.rows[0].canwrite == 1) {
                user.canwrite = true;
            } else {
                user.canwrite = false;
            }
            xemo.server.handlerL3(state, req, res, args, user);
        });
    });
}

xemo.server.handlerL1 = function (state, req, res, data) {
    var args = {};
    if (url.indexOf('?') > -1) {
        var _args = url.substring(url.indexOf('?') + 1);
        _args = _args.split('&');
        for (var x = 0; x < _args.length; ++x) {
            var pair = _args.split('=');
            var key = pair[0];
            var value = pair[1];
            value = decodeURI(value);
            args[key] = value;
        }
    }

    if (data != null) {
        var eargs = JSON.parse(data);
        for (var k in eargs) {
            args[k] = eargs[k];
        }
    }

    console.log('URL: ' + url);
    console.log(args);

    xemo.server.handlerL2(state, req, res, args);
}

xemo.server.handlerL0 = function (state, req, res) {
    try {
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
                xemo.server.handlerL1(state, req, res, data);
            });
        }

        xemo.server.handlerL1(state, req, res, null);
    } catch (err) {
        // To prevent the destruction of the entire server
        // we need to catch thrown errors here. Then log
        // these errors for diagnostics.
        console.log(err.stack);
    }
}

var state = {
    db: {
        type:    'sqlite3',
        path:    './xxx.db'
    }
};

/*
var db = xemo.server.opendatabase(state);
var t = db.transaction()
t.add('SELECT a, b FROM test WHERE a > 2', undefined, 'a');
t.execute(function (t) {
    console.log('here');
    console.log(t.results.a.rows[0]);
});

var t = db.transaction()
t.add('SELECT a, b FROM test WHERE a > 2', undefined, 'a');
t.execute(function (t) {
    console.log('here');
    console.log(t.results.a.rows[0]);
});
*/

http.createServer(function (req, res) {
    xemo.server.handlerL0(state, req, res);
}).listen(7634);

//var server = https.createServer(options, _handler);
//server.listen(4372);

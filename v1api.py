import webcore
import sqlite3
import os
import json
import uuid
import datetime
import time
import dateutil.parser
import pytz
import hashlib
import traceback

def reqmain(args):
    op = args['op']

    sqlconn = sqlite3.connect('data.db') 
    c = sqlconn.cursor()

    # Some initial setup...
    #a = hashlib.sha512(b'kmcguire:k3r9').hexdigest()
    #c.execute('UPDATE personnel_auth SET username = "kmcguire", hash = "%s" WHERE id = 2' % a)
    a = hashlib.sha512(b'anybody:ems').hexdigest()
    c.execute('UPDATE personnel_auth SET username = "anybody", hash = "%s" WHERE id = 15' % a)    
    sqlconn.commit()

    fd = open('tmp', 'w')
    fd.write(args['key'])
    fd.close();

    # Do we know this personnel?
    c.execute('SELECT id, username FROM personnel_auth WHERE hash = "%s"' % args['key'])
    pread = False
    pwrite = False
    result = c.fetchone()
    if result is None:
        raise Exception('Access was denied based on authentication.')
    cur_username = result[1]
    cur_id = int(result[0])
    # What permissions do they have?
    c.execute('SELECT canwrite FROM personnel_perm_rw WHERE id = %s' % result[0])
    result = c.fetchone()
    if result is None:
        raise Exception('The personnel has no entry for read/write permission.')
    # Allows future support of more values to represent special permission.
    if result[0] == 1:
        pwrite = True;
        pread = True
    if result[0] == 0:
        pread = True

    if pread is False:
        raise Exception('You must have at least read permission to access the system.')

    if op == 'verify':
        out = pwrite
        return { 'perm': result[0], 'username': cur_username, 'id': cur_id }
    if op == 'enum_years':
        grp = args['grp']        
        c.execute('SELECT DISTINCT strftime("%%Y", date) FROM grp_%s ORDER BY date' % 'driver')
        out = []
        for rec in c.fetchall():
            out.append(int(rec[0]))
        return out
    if op == 'enum_months':
        grp = args['grp']
        c.execute('SELECT DISTINCT strftime("%%m", date) FROM grp_%s ORDER BY date' % 'driver')
        out = []
        for rec in c.fetchall():
            out.append(int(rec[0]))
        return out
    if op == 'dayunlock':
        grp = args['grp']
        year = '%04d' % int(args['year'])
        month = '%02d' % int(args['month'])
        day = '%02d' % int(args['day'])        
        c.execute('''
            INSERT OR REPLACE INTO grpdaylock_{grp}
                SELECT date, lockeduntil, bypid FROM (
                SELECT date, lockeduntil, bypid, 1 AS tmp FROM grpdaylock_{grp}
                    WHERE grpdaylock_{grp}.date = julianday("{year}-{month}-{day}") AND
                    grpdaylock_{grp}.bypid <> {pid}
                UNION
                    SELECT julianday("{year}-{month}-{day}") AS date, 0 As lockeduntil, 0 as bypid, 0 AS tmp)
                ORDER BY tmp DESC
                LIMIT 1;
            SELECT date, lockeduntil, bypid FROM grpdaylock_driver
                WHERE date = julianday("{year}-{month}-{day}")
        ''')
        return 'success'
    if op == 'daylock':
        if pwrite is False:
            raise Exception('You need write permission to lock a day for editing.')
        # In order to reduce bugs we do the check in SQL to see if the day can be locked
        # by using the current SQL time, and we also make SQL produce a locked until time.
        grp = args['grp']
        year = '%04d' % int(args['year'])
        month = '%02d' % int(args['month'])
        day = '%02d' % int(args['day'])
        delta = int(args['delta']);
        sql = '''
            INSERT OR REPLACE INTO grpdaylock_{grp}
                SELECT date, lockeduntil, bypid FROM (
                SELECT date, lockeduntil, bypid, 1 AS tmp FROM grpdaylock_{grp}
                    WHERE grpdaylock_{grp}.date = julianday("{year}-{month}-{day}") AND
                    grpdaylock_{grp}.lockeduntil >= strftime("%s", "now")
                UNION
                    SELECT julianday("{year}-{month}-{day}") AS date, (strftime("%s", "now") + {delta}) As lockeduntil, {pid} as bypid, 0 AS tmp)
                ORDER BY tmp DESC
                LIMIT 1;
        '''.format(
                grp = grp,
                delta = delta,
                year = year, month = month, day = day, pid = cur_id
            )
        c.execute(sql);
        c.execute('''
            SELECT date, lockeduntil, bypid FROM grpdaylock_{grp}
                WHERE date = julianday("{year}-{month}-{day}");           
        '''.format(
            grp = grp, year = year, month = month, day = day
        ))
        rec = c.fetchone()
        if int(rec[2]) == cur_id:
            # Since we did a write. Let us be explicit that we want to commit the transaction.
            sqlconn.commit()
            return { 'code': 'accepted', 'pid': cur_id }
        return { 'code': 'denied', 'pid': rec[2] }
    if op == 'dayread':
        grp = args['grp']
        year = '%04d' % int(args['year'])
        month = '%02d' % int(args['month'])
        day = '%02d' % int(args['day'])
        #return 'SELECT text FROM grp_%s WHERE date = "%s-%s-%s"' % (grp, year, month, day)
        c.execute('SELECT text FROM grp_%s WHERE date = julianday("%s-%s-%s") ORDER BY date' % (grp, year, month, day))
        return c.fetchone()[0]
    if op == 'daywrite':
        if pwrite is False:
            raise Exception('You need write permission to write to a day.')        
        grp = args['grp']
        year = '%04d' % int(args['year'])
        month = '%02d' % int(args['month'])
        day = '%02d' % int(args['day'])
        sql = 'INSERT OR REPLACE INTO grp_{group} (date, text) VALUES (julianday("{year}-{month}-{day}"), "{text}")'.format(
            group = grp,
            year = year,
            month = month,
            day = day,
            text = args['txt'].replace('\n', '\x06').replace('\r', '')
        )
        c.execute(sql)
        sqlconn.commit()
        return 'success'
    if op == 'readcalendar':
        grp = args['grp']
        fyear = '%04d' % int(args['from_year'])
        fmonth = '%02d' % int(args['from_month'])
        fday = '%02d' % int(args['from_day'])
        tyear = '%04d' % int(args['to_year'])
        tmonth = '%02d' % (int(args['to_month']))
        tday = '%02d' % int(args['to_day'])
        c.execute(
            'SELECT strftime("%%Y", date), strftime("%%m", date), strftime("%%d", date), text FROM grp_%s WHERE date >= julianday("%s-%s-%s") and date < julianday("%s-%s-%s") ORDER BY date' %
            (grp, fyear, fmonth, fday, tyear, tmonth, tday)
        )
        out = []
        for rec in c.fetchall():
            out.append((int(rec[0]), int(rec[1]), int(rec[2]), rec[3]))
        return out
    if op == 'readcalls':
        fyear = '%04d' % int(args['from_year'])
        fmonth = '%02d' % int(args['from_month'])
        fday = '%02d' % int(args['from_day'])
        tyear = '%04d' % int(args['to_year'])
        tmonth = '%02d' % (int(args['to_month']))
        tday = '%02d' % int(args['to_day'])
        c.execute('''
            SELECT id, datetime, crew, disposition FROM ilog
                WHERE datetime >= strftime("%%s", "%s-%s-%s") AND
                      datetime < strftime("%%s", "%s-%s-%s")
        ''' % (fyear, fmonth, fday, tyear, tmonth, tday))
        out = []
        for rec in c.fetchall():
            out.append((rec[0], rec[1], rec[2], rec[3]))
        return out
    if op == 'get_personnel_attributes':
        if 'ids' not in args:
            return {}
        ids = args['ids'].split(',')
        out = {}
        for i in ids:
            sqlstr = 'SELECT attribute_id FROM personnel_attributes WHERE personnel_id = %s' % i
            c.execute(sqlstr)
            out[i] = []
            for rec in c.fetchall():
                out[i].append(int(rec[0]))
        return out
    if op == 'getpaysysinfo':
        out = {
            'mapping': {},
            'ppref':   {},
            'systems': {},
            'error':   {}
        }
        if 'ids' not in args:
            return out
        ids = args['ids'].split(',');
        for x in range(0, len(ids)):
            ids[x] = int(ids[x]);
        c.execute('SELECT pid, sysid, start, end FROM personnel_paysystem')
        for rec in c.fetchall():
            pid = int(rec[0])
            sysid = int(rec[1])
            ppstart = int(rec[2])
            ppend = int(rec[3])
            if pid in ids:
                if pid not in out['mapping']:
                    out['mapping'][pid] = []
                out['mapping'][pid].append({ 'sysid': sysid, 'start': ppstart, 'end': ppend })
        c.execute('SELECT pid, payperiodref FROM personnel_payperiodref')
        for rec in c.fetchall():
            out['ppref'][int(rec[0])] = int(rec[1])
        c.execute('SELECT sysid, sysname, config, desc, payperiodref FROM paysystem_spec')
        for rec in c.fetchall():
            sysid = rec[0]
            sysname = rec[1]
            config = rec[2]
            desc = rec[3]
            payperiodref = rec[4];
            out['systems'][sysid] = {
                'sysname':      sysname,
                'config':       config,
                'desc':         desc,
                'payperiodref': payperiodref
            }
        return out
    if op == 'gen_document':
        data = args['data']
        ext = args['ext']
        uname = uuid.uuid4().hex
        fd = open('./temp/' + uname + '.' + ext, 'w')
        fd.write(data)
        fd.close()
        return '/temp/' + uname + '.' + ext
    if op == 'get_personnel_names':
        if 'ids' not in args:
            return {'mapping': {}, 'error': {}}
        ids = args['ids'].split(',')
        for x in range(0, len(ids)):
            ids[x] = int(ids[x])
        out = {}
        out['mapping'] = {}
        c.execute('SELECT id, firstname, middlename, lastname, surname FROM personnel')
        for rec in c.fetchall():
            if rec[0] in ids:
                out['mapping'][rec[0]] = '%s %s %s %s' % (rec[1], rec[2], rec[3], rec[4])
                ids.remove(rec[0])
        out['error'] = ids;
        return out
    if op == 'get_personnel_data':
        c.execute('SELECT id, firstname, middlename, lastname, surname, dateadded FROM personnel')
        out = {}
        for rec in c.fetchall():
            out[int(rec[0])] = {
                'firstname':   rec[1],
                'middlename':  rec[2],
                'lastname':    rec[3],
                'surname':     rec[4],
                'dateadded':   rec[5]
            }
        return out
    # DEPRECATED
    if op == 'get_personnel_ids':
        if 'names' not in args:
            return {'mapping': {}, 'error': {}}
        names = args['names'].split(',')
        out = {}
        out['mapping'] = {}
        out['error'] = {}
        for name in names:
            name = name.strip()
            try:
                out['mapping'][name] = int(get_personnel_id_fromname(name, c))
            except Exception as e:
                out['error'][name] = traceback.format_exc()
        return out

    raise Exception('The operation specified was not supported.')

def conversion():
    from calendar import monthrange

    sqlconn = sqlite3.connect('data.db')
    c = sqlconn.cursor()

    c.execute('DROP TABLE grp_driver')
    c.execute('DROP TABLE grp_medic')
    c.execute('DROP TABLE chglog')

    c.execute('CREATE TABLE grp_driver (date REAL PRIMARY KEY, text TEXT)')
    c.execute('CREATE TABLE grp_medic (date REAL PRIMARY KEY, text TEXT)')
    c.execute('CREATE TABLE chglog (id INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER, text TEXT)')
    
    done = {}

    for node in os.listdir('./'):
        nparts = node.split('.')
        if nparts[0] != 'data':
            continue
        if len(nparts) > 4:
            continue
        if len(nparts) < 4:
            continue
        group = nparts[1].lower()
        year = int(nparts[2])
        month = int(nparts[3])

        daycnt = monthrange(year, month)[1]

        year = '%04d' % year
        month = '%02d' % month

        fd = open(node, 'r')
        lines = fd.readlines()
        fd.close()

        for ndx in range(0, len(lines)):
            if ndx == daycnt:
                break
            day = '%02d' % (ndx + 1)
            key = '%s-%s-%s-%s' % (group, year, month, day)
            if key in done:
                raise Exception(key)
            done[key] = True
            print(node, year, month, day, lines[ndx])
            c.execute('''
                INSERT INTO grp_%s (date, text) 
                    VALUES (julianday("%s-%s-%s"), "%s")
            ''' % (group, year, month, day, lines[ndx].replace('\x09', '\x06')))

    sqlconn.commit()

'''
    This takes a name as a string and a database cursor and attempts to
    match it to the database personnel table. It will throw an excception
    if the attempt is unsuccessful.
'''
def get_personnel_id_fromname(name, cursor):
    name = name.lower()
    match = None
    cursor.execute('SELECT id, firstname, middlename, lastname, surname FROM personnel')
    for rec in cursor.fetchall():
        id = rec[0]
        f = rec[1].lower()
        m = rec[2].lower()
        l = rec[3].lower()
        u = rec[4].lower()

        for x in range(1, 2 ** 4):
            o = []
            if x & 1:
                o.append(f)
            if x & 2:
                o.append(m)
            if x & 4:
                o.append(l)
            if x & 8:
                o.append(u)
            o = ' '.join(o)
            if name == o:
                if match is not None:
                    raise Exception('ambigious name for "%s"' % name)
                match = id
    if match is None:
        raise Exception('no personnel found for "%s"' % name)
    return match


def addcallsandpersonnel():
    sqlconn = sqlite3.connect('data.db')
    c = sqlconn.cursor()

    try:
        c.execute('DROP TABLE ilog')
    except:
        pass

    try:
        c.execute('DROP TABLE personnel')
    except:
        pass
    try:
        c.execute('DROP TABLE crew')
    except:
        pass

    try:
        c.execute('DROP TABLE crew_function')
    except:
        pass

    c.execute('CREATE TABLE crew_function (id INTEGER PRIMARY KEY, description TEXT)')
    c.execute('CREATE TABLE crew (personnel_id INTEGER, crew_id TEXT, crew_function_id INTEGER)')
    c.execute('CREATE TABLE ilog (id INTEGER PRIMARY KEY, datetime INTEGER, location TEXT, crew TEXT, disposition INTEGER)')
    c.execute('CREATE TABLE personnel (id INTEGER PRIMARY KEY, firstname TEXT, middlename TEXT, lastname TEXT, surname TEXT)')

    c.execute('INSERT INTO crew_function (id, description) VALUES (0, "primary paramedic")')
    c.execute('INSERT INTO crew_function (id, description) VALUES (1, "primary driver")')

    def getcrew(crew, makenew = True):
        dbg = crew
        if crew.strip() == '':
            return '0'
        print('processing crew %s' % crew)
        tmp = crew.split(',')
        bucket = {}
        crew = {}
        for m in tmp:
            if m.strip() == '':
                continue
            m = m.split(':')
            print('@', m)
            function = m[0]
            name = m[1]
            pid = get_personnel_id_fromname(name, c)
            crew[pid] = int(function)
            c.execute('SELECT crew_id FROM crew WHERE personnel_id = %s' % pid)
            tmp = c.fetchall()
            bucket[pid] = []
            for rec in tmp:
                bucket[pid].append(rec[0])
            print('bucket for %s is %s' % (name, bucket))

        for pid in bucket:
            crews = bucket[pid]
            for crew_id in crews:
                c.execute('SELECT personnel_id, crew_function_id FROM crew WHERE crew_id = "%s"' % crew_id)
                tmp = c.fetchall()
                sqlout = []
                fmap = {}
                for rec in tmp:
                    sqlout.append(rec[0])
                    fmap[rec[0]] = rec[1]
                reject = False
                for pid in sqlout:
                    # if the current crew we are looking at does not contain
                    # this personnel or this personnel's function is different
                    # then reject this crew as a match
                    if pid not in bucket or fmap[pid] != crew[pid]:
                        reject = True
                        break
                if reject is True:
                    continue
                for pid in bucket:
                    # if a crew member in the crew in the db is not in the current
                    # crew, or the crew member function does not match
                    if pid not in sqlout or fmap[pid] != crew[pid]:
                        reject = True
                        break
                if reject:
                    break
                return crew_id
        if makenew:
            crew_uuid = uuid.uuid4().hex
            v = []
            for pid in crew:
                v.append('(%s, "%s", %s)' % (pid, crew_uuid, crew[pid]))
            # hopefully an atomic operation
            sqlstr = 'INSERT INTO crew (personnel_id, crew_id, crew_function_id) VALUES %s' % ','.join(v)
            print(dbg, sqlstr)
            c.execute(sqlstr)
            return crew_uuid
        return None
    #


    def addpersonnel(id, first, middle, last, surname):
        c.execute('''
            INSERT INTO personnel (id, firstname, middlename, lastname, surname)
                VALUES (%s, "%s", "%s", "%s", "%s")
        ''' % (id, first, middle, last, surname))

    def addone(id, datetime, disposition, crew, location):
        datetime = '%s CDT' % datetime

        tzinfo = {
            'CDT':    pytz.timezone('CST6CDT')
        }

        datetime = dateutil.parser.parse(datetime, tzinfos = tzinfo)

        c.execute('''
            INSERT INTO ilog (id, datetime, location, crew, disposition)
                VALUES (%s, strftime('%%s', "%s"), "%s", "%s", %s)
        ''' % (id, datetime, location, crew, disposition))

    addpersonnel(0, 'andrew', '', 'wood', '')
    addpersonnel(1, 'jesse', '', '', '')
    addpersonnel(2, 'leonard', 'kevin', 'mcguire', 'jr')
    addpersonnel(3, 'david', '', 'ingram', '')
    addpersonnel(4, 'sonia', '', 'taylor', '')
    addpersonnel(5, 'john', '', 'estes', '')
    addpersonnel(6, 'nikki', '', 'barris', '')
    addpersonnel(7, 'eddie', '', 'bryant', '')
    addpersonnel(8, 'josh', '', 'dorminey', '')
    addpersonnel(9, 'ethan', '', 'colley', '')
    addpersonnel(10, 'heather', '', 'martin', '')
    addpersonnel(11, 'brittney', '', '', '')
    addpersonnel(12, 'justin', '', 'hunt', '')
    addpersonnel(13, 'todd', '', '', '')
    addpersonnel(14, 'doug', '', '', '')

    addone(1506172, '2015-06-01 18:50', 5, getcrew('1:andrew,0:jesse'), '215 fleahop rd')
    addone(1506173, '2015-06-02 10:38', 0, getcrew('1:kevin,0:david'), '156 double bridge ferry rd')
    addone(1506174, '2015-06-03 08:43', 1, getcrew('1:kevin,0:justin'), '647 kowaliga rd')
    addone(1506175, '2015-06-04 01:36', 5, getcrew('1:john,0:justin'), '156 nichols ave')
    addone(1506176, '2015-06-06 18:18', 2, getcrew('1:nikki,0:sonia'), '51 main st')
    addone(1506177, '2015-06-07 03:07', 1, getcrew('1:nikki,0:sonia'), '1060 claud rd lot 16')
    addone(1506178, '2015-06-08 18:05', 0, getcrew('1:kevin,0:david'), '30 varner st')
    addone(1506179, '2015-06-09 08:48', 2, getcrew('1:kevin,0:justin'), '1000 claud road')
    addone(1506180, '2015-06-10 11:16', 5, getcrew('1:kevin,0:sonia'), '215 fleahop rd')
    addone(1506181, '2015-06-11 10:20', 1, getcrew('1:kevin,0:jesse'), '610 fleahop rd')
    addone(1506182, '2015-06-11 18:13', 5, getcrew('1:kevin,0:sonia'), '')
    addone(1506183, '2015-06-13 13:00', 5, getcrew('0:sonia'), 'station #1')
    addone(1506184, '2015-06-15 13:33', 3, getcrew('1:kevin,0:eddie'), '510 union rd')
    addone(1506185, '2015-06-15 16:19', 5, getcrew('1:kevin,0:eddie'), '200 fleahop rd')
    addone(1506186, '2015-06-15 20:35', 4, getcrew('1:john,0:eddie'), '76 oliver rd')
    addone(1506187, '2015-06-16 16:33', 2, getcrew('1:kevin,0:sonia'), '1060 claud rd lot 15')
    addone(1506188, '2015-06-18 03:24', 5, getcrew('1:dorminey,0:todd'), '1186 salem rd')
    addone(1506189, '2015-06-18 11:08', 5, getcrew('1:kevin,0:david'), '1060 claud rd lot')
    addone(1506190, '2015-06-20 10:00', 5, getcrew('0:sonia'), '145 main st')
    addone(1506191, '2015-06-20 09:44', 6, getcrew('1:andrew,0:sonia'), '215 fleahop rd')
    addone(1506192, '2015-06-20 11:57', 6, getcrew('1:andrew,0:sonia'), '644 old avant rd')
    addone(1506193, '2015-06-20 12:10', 5, getcrew('1:andrew,0:sonia'), '675 n college')
    addone(1506194, '2015-06-20 21:00', 2, getcrew('1:heather,0:sonia'), '305 1st ave')
    addone(1506195, '2015-06-20 22:49', 9, getcrew('1:heather,0:sonia'), '1260 mt hebron')
    addone(1506196, '2015-06-21 11:53', 5, getcrew('1:nikki,0:justin'), 'first baptist church')
    addone(1506197, '2015-06-23 08:52', 5, getcrew(''), '195 fleahop rd')
    addone(1506198, '2015-06-24 22:58', 0, getcrew('1:ethan,0:justin'), '1486 neman rd')
    addone(1506199, '2015-06-25 02:22', 1, getcrew('1:ethan,0:justin'), '1186 old salem rd')
    addone(1506200, '2015-06-26 07:53', 7, getcrew('1:kevin,0:sonia'), 'w collins @ blount')
    addone(1506201, '2015-06-26 09:36', 7, getcrew('1:kevin,0:doug'), '312 ridgeway dr')
    addone(1506202, '2015-06-27 05:56', 7, getcrew('0:doug'), '3705 claud rd')
    addone(1506203, '2015-06-27 18:44', 3, getcrew('1:brittney,0:sonia') , '13 rosewood apt b2')
    addone(1506204, '2015-06-28 15:31', 8, getcrew('1:andrew,0:jesse'), '4249 claud rd')
    sqlconn.commit()

#addcallsandpersonnel()
#conversion()

webcore.start(reqmain)
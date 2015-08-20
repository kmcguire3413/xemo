const xml2js = require('xml2js');
const Guid = require('guid');
const fs = require('fs');
//const admzip = require('adm-zip');
const admzip = null;
const JSZip = require('jszip');
const sax = require('./sax.js');

var xps = {};

module.exports = xps;

xps.VFS = function () {
	this.root = {};
	return this;
};

xps.VFS_fromZip = function (path, cb) {
	var vfs = new xps.VFS();

	if (admzip != null) {
		var zip = new admzip(path);
		var zipnodes = zip.getEntries();

		zipnodes.forEach(function (zipnode) {
			//console.log(zipnode.);
			if (zipnode.isDirectory) {
				return;
			}

			var path = zipnode.entryName;
			
			vfs.writeWhole(path, zipnode.getData());
		});

		cb(vfs);
	} else {
		fs.readFile(path, function (err, data) {
			if (err) {
				throw err;
			}

			var zip = new JSZip();
			zip.load(data, { createFolders: false });

			for(var zpath in zip.files) {
				if (zpath.dir) {
					continue;
				}

				vfs.writeWhole(zpath, zip.files[zpath].asNodeBuffer());
			}

			cb(vfs);
		});
	}
};

xps.VFS.prototype.toZip = function (zpath, cb) {
	if (admzip != null) {
		var zip = new admzip();

		for (var path in this.root) {
			console.log(path);
			//this.root[path]
			zip.addFile(path, new Buffer('hello world', 'utf-8'), '');
		}

		zip.writeZip(zpath);

		cb();
	} else {
		var zip = new JSZip();

		for (var path in this.root) {
			zip.file(path, this.root[path]);
		}

		var zdata = zip.generate({ type: 'nodebuffer' });
		fs.writeFile(zpath, zdata);
		cb();
	}
};

xps.VFS.prototype.writeWhole = function (path, data) {
	this.root[path] = data;
};

xps.VFS.prototype.readWhole = function (path) {
	return this.root[path];
};

xps.VFS.prototype.readDir = function (path) {
	if (path[path.length-1] != '/') {
		path = path + '/';
	}

	var nodes = [];

	for (var k in this.root) {
		if (k.indexOf(path) == 0) {
			k = k.substring(path.length);
			k = k.substring(0, k.indexOf('/') == -1 ? undefined : k.indexOf('/'));
			nodes.push(k);
		}
	}

	return nodes;
};


xps.save = function (xpsobj, cbforfile) {
	/*	
		FixedDocSeq.fdseq
			<FixedDocumentSequence xmlns="http://schemas.microsoft.com/xps/2005/06">
				<DocumentReference Source="/Documents/1/FixedDoc.fdoc"/>
			</FixedDocumentSequence>
	*/
};

xps.xmlparser = new xml2js.Parser({
	explicitArray:  		true,
	explicitChildren:       true,
	explicitRoot:           true,
	preserveChildrenOrder:  true
});

xps.obfuscateResource = function (respath, outpath) {
	var resname = respath.substring(respath.lastIndexOf('/') + 1, respath.lastIndexOf('.'));
	guid = new Guid.create();
	var shortguid = guid.toString().split('-').join('');

	var guidbytes = [];

	for (var x = 0; x < shortguid.length / 2; ++x) {
		var h = shortguid.substring(x * 2, x * 2 + 2);
		guidbytes.push(parseInt(h, 16));
	}

	var fin = fs.createReadStream(respath);
	var fout = fs.createWriteStream(outpath + guid.toString().toUpperCase() + '.odttf');
	var curpos = 0;

	fin.on('data', function (chunk) {
		if (curpos < 32) {
			while (curpos < 32) {
				var ndx = 16 - (curpos % 16) - 1;
				var chg = chunk[curpos] ^ guidbytes[ndx];
				chunk[curpos] = chg;
				++curpos;
			}
		}

		fout.write(chunk);
	});

	fin.on('end', function () {
		fin.close();
		fout.close();
	});
};

/*
	Use the XPS as a template. This assumes that the first
	page of the first document is intended to be the template.
*/
xps.SinglePageTemplate = function (vfs) {
	this.template = vfs.readWhole('Documents/1/Pages/1.fpage');

	/*
		MS encodes as UTF-16 with BOM.. I need to look at the
		standard and see what to expect.
	*/
	// TODO: review standards for potential encodings
	this.template = this.template.slice(2).toString('ucs2');

	this.pages = [];
	this.vfs = vfs;

	return this;
};


xps.SinglePageTemplate.prototype.producePages = function (cfg_ary, cb) {
	var cfg_index = 0;
	var self = this;

	function do_next_page() {
		self.producePage(cfg_ary[cfg_index], function () {
			++cfg_index;

			if (cfg_index >= cfg_ary.length) {
				cb(null, self);
				return;
			}
			/*
				This should help keep us from stack overflowing
				and at the same time help to split the operation
				into smaller slices of time.
			*/
			process.nextTick(do_next_page());
		});
	}

	do_next_page();
}

/*
	Produce a page using the template page.
*/
xps.SinglePageTemplate.prototype.producePage = function (cfg, cb) {
	var t = this.template;

	var vars = cfg.vars;
	console.log('vars', vars);
	var color_replace = cfg.color_replace;

	var parser = sax.parser(true);
	var rebuilt = [];
	var alreadyclosed = false;

	var _vars = {};

	for (var k in vars) {
		_vars['%%' + k + '%%'] = vars[k];
	}

	parser.onerror = function (err) {
		throw err;
	};

	parser.ontext = function (text) {
		rebuilt.push(text);
	};

	parser.onclosetag = function (name) {
		if (!alreadyclosed) {
			rebuilt.push('</' + name + '>');
		}
		/* Restore default mode. */
		alreadyclosed = false;
	};

	parser.onopentag = function (node) {
		rebuilt.push('<' + node.name + ' ');

		var removeIndices = false;
		for (var k in node.attributes) {
			var value = node.attributes[k];

			if (k == 'Color') {
				console.log('got color attribute', value);
				if (value.toLowerCase() in color_replace) {
					console.log('got value ' + value + ' in color replace');
					node.attributes[k] = color_replace[value.toLowerCase()].toUpperCase();
					continue;
				}
			}

			value = value.split('?').join('');
			if (_vars[value] != undefined) {
				/*
					I believe last time I checked a blank unicode string
					can cause problems with some viewers.
				*/
				node.attributes[k] = !_vars[value].length ? ' ' : _vars[value];
				removeIndices = true;
				continue;
			}
		}

		if (removeIndices) {
			delete node.attributes.Indices;
		}

		for (var k in node.attributes) {
			rebuilt.push(k + '="' + node.attributes[k] + '" ');
		}

		if (node.isSelfClosing) {
			rebuilt.push('/>');
			/* Override default mode of closing tags. */
			alreadyclosed = true;
		} else {
			rebuilt.push('>');
			alreadyclosed = false;
		}
	};

	parser.onattribute = function (node) {

	};

	var self = this;

	parser.onend = function () {
		console.log('done');
		rebuilt = rebuilt.join('');
		self.pages.push(new Buffer(rebuilt, 'utf-8'));
		cb();
	};

	parser.write(t).close();
};

/*
	This will remove the template page and add in the produced
	pages by updating the VFS that was provided.
*/
xps.SinglePageTemplate.prototype.compile = function () {
	var relfile = this.vfs.readWhole('Documents/1/Pages/_rels/1.fpage.rels');
	
	var fdoc = [
		'<?xml version="1.0" encoding="utf-8"?>',
		'<FixedDocument xmlns="http://schemas.microsoft.com/xps/2005/06">',
	];

	for (var x = 0; x < this.pages.length; ++x) {
		this.vfs.writeWhole('Documents/1/Pages/' + (x + 1) + '.fpage', this.pages[x]);
		this.vfs.writeWhole('Documents/1/Pages/_rels/' + (x + 1) + '.fpage.rels', relfile); 
		fdoc.push('<PageContent Source="/Documents/1/Pages/' + (x + 1) + '.fpage"/>')
	}

	fdoc.push('</FixedDocument>');

	this.vfs.writeWhole('Documents/1/FixedDoc.fdoc', new Buffer(fdoc.join('', 'utf-8')));
};

xps.load = function (vfs) {
	var d = vfs.readWhole('FixedDocSeq.fdseq');
	xps.xmlparser.parseString(d, function (err, fixed_doc_seq) {
		for(var x = 0; x < fixed_doc_seq.FixedDocumentSequence.$$.length; ++x) {
			var docref = fixed_doc_seq.FixedDocumentSequence.$$[x];
			var doc_source = docref.$.Source;
			// TODO: CHECK TAG NAME
			/* Fetch this source document. */
			var d = vfs.readWhole(doc_source);
			doc_base = doc_source.substring(0, doc_source.lastIndexOf('/') + 1);
			xps.xmlparser.parseString(d, function (err, docxml) {
				for (var x = 0; x < docxml.FixedDocument.$$.length; ++x) {
					var pageref = docxml.FixedDocument.$$[x];
					// TODO: CHECK TAG NAME
					var page_source = doc_base + pageref.$.Source;
					var d = vfs.readWhole(page_source);
					xps.xmlparser.parseString(d, function (err, pagexml) {
					});
				}
			});
		}
	});
};


 

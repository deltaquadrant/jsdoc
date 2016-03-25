/*global arguments, require: true */
/**
 * @project jsdoc
 * @author Mike Naughton <michael.d.naughton@gmail.com>
 * @license See LICENSE.md file included in this distribution.
 */

(function() {
	var path = require('path');

	// Create a custom require method that adds `lib/jsdoc` and `node_modules` to the module
	// lookup path. This makes it possible to `require('jsdoc/foo')` from external templates and
	// plugins, and within JSDoc itself. It also allows external templates and plugins to
	// require JSDoc's module dependencies without installing them locally.
	require = require('requizzle')({
	    requirePaths: {
	        before: [path.join(__dirname, 'lib')],
	        after: [path.join(__dirname, 'node_modules')]
	    },
	    infect: true
	});
})();

(function() {
	var app = require('./lib/jsdoc/app');
	var Config = require('./lib/jsdoc/config');
	var runtime = require('./lib/jsdoc/util/runtime');
	var env = require('./lib/jsdoc/env');
	var logger = require('./lib/jsdoc/util/logger');
	env.conf = (new Config()).get();

	var Parser = require('./lib/jsdoc/src/parser');


	function resolvePluginPaths(paths) {
	    var path = require('./lib/jsdoc/path');

	    var pluginPaths = [];

	    paths.forEach(function(plugin) {
	        var basename = path.basename(plugin);
	        var dirname = path.dirname(plugin);
	        var pluginPath = path.getResourcePath(dirname);
	        if (!pluginPath) {
							try {
								require(plugin);
								pluginPaths.push(plugin);
							} catch(e) {
	            	logger.error('Unable to find the plugin "%s"', plugin);
	            	return;
							}
	        } else {
	        	pluginPaths.push( path.join(pluginPath, basename) );
					}
	    });

	    return pluginPaths;
	}

	function scanFiles() {
    var Filter = require('./lib/jsdoc/src/filter').Filter;
    var filter;
    env.opts._ = buildSourceList();

    // are there any files to scan and parse?
    if (env.conf.source && env.opts._.length) {
        filter = new Filter(env.conf.source);

        env.sourceFiles = app.jsdoc.scanner.scan(env.opts._, (env.opts.recurse ? 10 : undefined),
            filter);
    }
	}

	function buildSourceList() {
	    var fs = require('./lib/jsdoc/fs');
	    var Readme = require('./lib/jsdoc/readme');

	    var packageJson;
	    var readmeHtml;
	    var sourceFile;
	    var sourceFiles = env.opts._ ? env.opts._.slice(0) : [];

	    if (env.conf.source && env.conf.source.include) {
	        sourceFiles = sourceFiles.concat(env.conf.source.include);
	    }

	    // load the user-specified package/README files, if any
	    if (env.opts.package) {
	        packageJson = readPackageJson(env.opts.package);
	    }
	    if (env.opts.readme) {
	        readmeHtml = new Readme(env.opts.readme).html;
	    }

	    // source files named `package.json` or `README.md` get special treatment, unless the user
	    // explicitly specified a package and/or README file
	    for (var i = 0, l = sourceFiles.length; i < l; i++) {
	        sourceFile = sourceFiles[i];

	        if ( !env.opts.package && /\bpackage\.json$/i.test(sourceFile) ) {
	            packageJson = readPackageJson(sourceFile);
	            sourceFiles.splice(i--, 1);
	        }

	        if ( !env.opts.readme && /(\bREADME|\.md)$/i.test(sourceFile) ) {
	            readmeHtml = new Readme(sourceFile).html;
	            sourceFiles.splice(i--, 1);
	        }
	    }

	    env.opts.packageJson = packageJson;
	    env.opts.readme = readmeHtml;

	    return sourceFiles;
	}


	function JsDoc(cwd, configuration, options, fileList){
		runtime.initialize([__dirname, cwd]);
		var config = new Config(JSON.stringify(configuration || {})); //TODO: change config to support actual objects
		env.conf = config.get();
		env.opts = options || {};
		env.opts._ = fileList || ['.'];
		if (!env.opts.destination) env.opts.destination = './out/';
		scanFiles();
	}

	JsDoc.prototype = {
		createParser: function(){
			var handlers = require('./lib/jsdoc/src/handlers');
			var path = require('./lib/jsdoc/path');
			var plugins = require('./lib/jsdoc/plugins');

			var parser = Parser.createParser(env.conf.parser);

			if (env.conf.plugins) {
			    env.conf.plugins = resolvePluginPaths(env.conf.plugins);
			    plugins.installPlugins(env.conf.plugins, parser);
			}

			handlers.attachTo(parser);
			return parser;
		},

		parseFiles: function(){
			var augment = require('./lib/jsdoc/augment');
			var borrow = require('./lib/jsdoc/borrow');
			var Package = require('./lib/jsdoc/package').Package;

			var docs;
			var packageDocs;
			var parser = this.createParser();

			docs = parser.parse(env.sourceFiles, env.opts.encoding);

			// If there is no package.json, just create an empty package
			packageDocs = new Package(env.opts.packageJson);
			packageDocs.files = env.sourceFiles || [];
			docs.push(packageDocs);

			borrow.indexAll(docs);
			augment.augmentAll(docs);
			borrow.resolveBorrows(docs);

			parser.fireProcessingComplete(docs);
			return docs;
		},

		dumpResults: function(){
			var dump = require('./lib/jsdoc/util/dumper').dump;
			return dump(this.parseFiles());
		},

		generateDocs: function() {
	    var path = require('./lib/jsdoc/path');
	    var resolver = require('./lib/jsdoc/tutorial/resolver');
	    var taffy = require('taffydb').taffy;

	    var template;

	    env.opts.template = (function() {
	        var publish = env.opts.template || 'templates/default';
	        var templatePath = path.getResourcePath(publish);

	        // if we didn't find the template, keep the user-specified value so the error message is
	        // useful
	        return templatePath || env.opts.template;
	    })();

	   // try {
	        template = require(env.opts.template + '/publish');
	    // }
	    // catch(e) {
	    // 		console.trace(e);
	    //     return 'Unable to load template: ' + (e.message || e);
	    // }

	    // templates should include a publish.js file that exports a "publish" function
	    if (template.publish && typeof template.publish === 'function') {
	        //logger.printInfo('Generating output files...');
	        return template.publish(
	            taffy(this.parseFiles()),
	            env.opts,
	            resolver.root
	        );
	    }
	    else {
	        return env.opts.template + ' does not export a "publish" function. Global ' +
	            '"publish" functions are no longer supported.';
	    }

	    return null;
		}



	};

	module.exports = JsDoc;
})();

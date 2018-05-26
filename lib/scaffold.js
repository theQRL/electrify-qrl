var fs     = require('fs');
var path   = require('path');
var shell  = require('shelljs');

module.exports = function($){
  return new Scaffold($);
};

function Scaffold($){
  this.$ = $;
  this.log = require('./log')($, 'electrify:scaffold');
}

Scaffold.prototype.prepare = function() {

  this.log.info('ensuring basic structure');
  
  shell.mkdir('-p' , this.$.env.app.bin);
  shell.mkdir('-p' , this.$.env.core.tmp);
  shell.mkdir('-p',  this.$.env.core.root);

  var index        = path.join(this.$.env.app.root, 'index.js');
  var packageJson  = path.join(this.$.env.app.root, 'package.json');
  var config       = path.join(this.$.env.app.root, 'electrify.json');
  var gitignore    = path.join(this.$.env.app.root, '.gitignore');

  var index_tmpl    = path.join(__dirname, 'templates', 'index.js');

  if(!fs.existsSync(index)) {
    fs.writeFileSync(index, fs.readFileSync(index_tmpl, 'utf8'));
  }

  if (!fs.existsSync(packageJson)) {
    fs.writeFileSync(packageJson, JSON.stringify({
      name: 'qrl-wallet',
      main: 'index.js',
      dependencies: { "electrify-qrl": this.$.env.version }
    }, null, 2));
  }

  if (!fs.existsSync(config)) {
    fs.writeFileSync(config, JSON.stringify({
      "plugins": []
    }, null, 2));
  }

  if (!fs.existsSync(gitignore)) {
    fs.writeFileSync(gitignore, [
        '.DS_Store', '.dist', 'app',
        'bin', 'db', 'node_modules'
      ].join('\n'));
  }
};

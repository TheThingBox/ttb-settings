const fs = require('fs');
const path = require('path');
const mkdirp = require('mkdirp');
const os = require('os');
const uuid = require('uuid/v4');
const cp = require('child_process');

class SettingsTTB{
  constructor(userdir, persistenceDir, certsOpt, apis){
    this._instance = uuid()
    this._updateApi = apis.update
    this._userDirSettings = path.join(userdir, 'thethingbox.json')
    this._persistenceDirSettings = path.join(persistenceDir, "settings.json")
    this._rsa = { server: {} }
    this._rsa.server.publicKey = path.join(certsOpt.certsDir, certsOpt.serverKey)
    this._rsa.publicKey = path.join(certsOpt.certsDir, certsOpt.publicKey)
    this._rsa.privateKey = path.join(certsOpt.certsDir, certsOpt.privateKey)
    this._settings = {}
    this._alllowSettings = ["rsa", "email", "account_id", "lang", "showall"]
    this._pitype = null
    this._modelToType = [
      {
        name: 'zero',
        types: ['Zero', 'Zero+'],
        supported: false
      },
      {
        name: 'a',
        types: ['A', 'A+'],
        supported: false
      },
      {
        name: 'b',
        types: ['B', 'B+', 'Unknown'],
        supported: true
      },
      {
        name: 'cm',
        types: ['CM', 'CM+'],
        supported: true
      },
      {
        name: 'unknown',
        types: ['Alpha', 'Internal'],
        supported: false
      }
    ]
  }

  get settings(){
    return JSON.parse(JSON.stringify(this._settings))
  }

  get type(){
    return this._pitype
  }

  load(){
    return new Promise( (resolve, reject) => {
      this.checkRSAKey()
      .then(_ => {
        return getUserSettings()
      })
      .then(userSettings => {
        this._settings = Object.assign({}, userSettings)
        return getPersistedSettings()
      })
      .then(persistedSettings => {
        this._settings = Object.assign({}, this._settings, persistedSettings)
        return
      })
      .finally( _ => {
        resolve(this.settings)
      })
    })
  }

  checkRSAKey(){
    return new Promise( (resolve, reject) => {
      const promises = []
      promises.push(this.checkRSAPrivFile())
      promises.push(this.checkRSAPubFile())

      Promise.all(promises).then((values)  => {
        if(values.filter(e => e == 'ok').length !== promises.length){
          this.createRSAKey().then().catch().finally(_=>{
            resolve()
          })
        } else {
          resolve()
        }
      });
    })
  }

  createRSAKey(){
    return new Promise( (resolve, reject) => {
      fs.unlink(this._rsa.privateKey, (err) => {
        fs.unlink(this._rsa.publicKey, (err) => {
          cp.exec(`openssl genrsa -out ${this._rsa.privateKey} 2048`, (err, stdout, stderr) => {
            cp.exec(`openssl rsa -in ${this._rsa.privateKey} -pubout -out ${this._rsa.publicKey}`, (err, stdout, stderr) => {
              resolve();
            });
          });
        })
      })
    })
  }

  checkRSAPrivFile(){
    return new Promise( (resolve, reject) => {
      fs.readFile(this._rsa.privateKey, 'utf8', (err, data) => {
        if(err){
          resolve('nok')
          return
        }
        let lastLine = data.split('\n').filter(e=>e)
        if(lastLine.length > 1){
          lastLine = lastLine[lastLine.length-1]
        } else {
          lastLine = ''
        }
        if(lastLine === '-----END RSA PRIVATE KEY-----'){
          resolve('ok')
        } else {
          resolve('nok')
        }
      });
    })
  }

  checkRSAPubFile(){
    return new Promise( (resolve, reject) => {
      fs.readFile(this._rsa.publicKey, 'utf8', (err, data) => {
        if(err){
          resolve('nok')
          return
        }
        let lastLine = data.split('\n').filter(e=>e)
        if(lastLine.length > 1){
          lastLine = lastLine[lastLine.length-1]
        } else {
          lastLine = ''
        }
        if(lastLine === '-----END PUBLIC KEY-----'){
          resolve('ok')
        } else {
          resolve('nok')
        }
      });
    })
  }

  getUserSettings(){
    return new Promise( (resolve, reject) => {
      let settings = {}
      let t = null
      try {
        t = fs.readFileSync(this._userDirSettings).toString();
        settings = JSON.parse(t);
      } catch(e){}

      if(t===null){
        settings.rsa = this.rsa
        this.createSettings(this._userDirSettings, settings)
        .then().catch().finally(_ => {
          resolve(settings)
        })
      } else {
        resolve(settings)
      }
    })
  }

  getPersistedSettings(){
    return new Promise( (resolve, reject) => {
      let settings = {}
      let t = null
      try {
        t = fs.readFileSync(this._persistenceDirSettings).toString();
        settings = JSON.parse(t);
      } catch(e){}

      if(t===null){
        this.getPiModel().then( _pitype => {
          setting_persistence.id = this._instance
          setting_persistence.update = {
            url: this._updateApi,
            type: _pitype
          }
          this.createSettings(this._persistenceDirSettings, settings)
          .then().catch().finally(_ => {
            resolve(settings)
          })
        })
      } else {
        resolve(settings)
      }
    })
  }

  createSettings(filename, content){
    return new Promise( (resolve, reject) => {
      mkdirp(path.dirname(filename), function(err) {
        if (err){
          return resolve(err);
        }
        fs.writeFile(filename, JSON.stringify(content), {encoding: 'utf8', flag: 'w'}, function(err) {
          if (err){
            return resolve(err);
          }
          resolve()
        });
      });
    })
  }

  getPiModel(){
    return new Promise( (resolve, reject) => {
      if(this._pitype !== null){
        resolve(this._pitype)
      }
      else{
        fs.readFile('/proc/cpuinfo', 'utf8', (err, data) => {
            if(!err){
                let _pitype = { type: "" };
                let revision
                try{
                    revision = data.split('Revision')[1].split('\n')[0].split(': ')[1].trim()
                } catch(e){
                  reject(e)
                }
                if(revision){
                    if(revision.length === 6){
                        let binaryRev = ""
                        revision.match(/.{1,2}/g).forEach(str => {
                            binaryRev += ("00000000" + (parseInt(str, 16)).toString(2)).substr(-8);
                        })
                        _pitype.rev = parseInt(binaryRev.substr(binaryRev.length-4,4), 2)
                        switch (parseInt(binaryRev.substr(binaryRev.length-12,8), 2).toString(16)) {
                            case '0': _pitype.type = "A"; _pitype.pi = 1; break;
                            case '1': _pitype.type = "B"; _pitype.pi = 1; break;
                            case '2': _pitype.type = "A+"; _pitype.pi = 1; break;
                            case '3': _pitype.type = "B+"; _pitype.pi = 1; break;
                            case '4': _pitype.type = "B"; _pitype.pi = 2; break;
                            case '5': _pitype.type = "Alpha"; _pitype.pi = -1; break;
                            case '6': _pitype.type = "CM"; _pitype.pi = 1; break;
                            case '8': _pitype.type = "B"; _pitype.pi = 3; break;
                            case '9': _pitype.type = "Zero"; _pitype.pi = 0; break;
                            case 'a': _pitype.type = "CM"; _pitype.pi = 3; break;
                            case 'c': _pitype.type = "Zero W"; _pitype.pi = 0; break;
                            case 'd': _pitype.type = "B+"; _pitype.pi = 3; break;
                            case 'e': _pitype.type = "A+"; _pitype.pi = 3; break;
                            case 'f': _pitype.type = "Internal"; _pitype.pi = -1; break;
                            case '10': _pitype.type = "CM+"; _pitype.pi = 3; break;
                            case '11': _pitype.type = "B"; _pitype.pi = 4; break;
                            default : _pitype.type = "Unknown"; _pitype.pi = 3; break;
                        }

                        switch (parseInt(binaryRev.substr(binaryRev.length-16,4), 2)) {
                            case 0: _pitype.processor = "BCM2835"; break;
                            case 1: _pitype.processor = "BCM2836"; break;
                            case 2: _pitype.processor = "BCM2837"; break;
                            case 3: _pitype.processor = "BCM2711"; break;
                            default : _pitype.processor = "Unknown"; break;
                        }
                        switch (parseInt(binaryRev.substr(binaryRev.length-20,4), 2)) {
                            case 0: _pitype.manufacturer = "Sony US"; break;
                            case 1: _pitype.manufacturer = "Egoman"; break;
                            case 2: _pitype.manufacturer = "Embest"; break;
                            case 3: _pitype.manufacturer = "Sony Japan"; break;
                            case 4: _pitype.manufacturer = "Embest"; break;
                            case 5: _pitype.manufacturer = "Stadium"; break;
                            default : _pitype.manufacturer = "Unknown"; break;
                        }
                        switch (parseInt(binaryRev.substr(binaryRev.length-23,3), 2)) {
                            case 0: _pitype.ram = "256M"; break;
                            case 1: _pitype.ram = "512M"; break;
                            case 2: _pitype.ram = "1024M"; break;
                            case 3: _pitype.ram = "2048M"; break;
                            case 4: _pitype.ram = "4096M"; break;
                            default: _pitype.ram = "Unknown"; break;
                        }
                    }
                    else if(revision.length === 4){
                      _pitype.pi = 1;
                      if (revision === "0002" || revision === "0003"){
                         _pitype.type = "Model B";
                         _pitype.rev = 1;
                         _pitype.ram = "256M";
                         _pitype.processor = "BCM2835";
                      } else if (revision === "0004") {
                         _pitype.type = "Model B";
                         _pitype.rev = 2;
                         _pitype.ram = "256M";
                         _pitype.manufacturer = "Sony";
                         _pitype.processor = "BCM2835";
                      } else if (revision === "0005") {
                         _pitype.type = "Model B";
                         _pitype.rev = 2;
                         _pitype.ram = "256M";
                         _pitype.manufacturer = "Qisda";
                         _pitype.processor = "BCM2835";
                      } else if (revision === "0006") {
                         _pitype.type = "Model B";
                         _pitype.rev = 2;
                         _pitype.ram = "256M";
                         _pitype.manufacturer = "Egoman";
                         _pitype.processor = "BCM2835";
                      } else if (revision === "0007") {
                         _pitype.type = "Model A";
                         _pitype.rev = 2;
                         _pitype.ram = "256M";
                         _pitype.manufacturer = "Egoman";
                         _pitype.processor = "BCM2835";
                      } else if (revision === "0008") {
                         _pitype.type = "Model A";
                         _pitype.rev = 2;
                         _pitype.ram = "256M";
                         _pitype.manufacturer = "Sony";
                         _pitype.processor = "BCM2835";
                      } else if (revision === "0009") {
                         _pitype.type = "Model A";
                         _pitype.rev = 2;
                         _pitype.ram = "256M";
                         _pitype.manufacturer = "Qisda";
                         _pitype.processor = "BCM2835";
                      } else if (revision === "000d") {
                         _pitype.type = "Model B";
                         _pitype.rev = 2;
                         _pitype.ram = "512M";
                         _pitype.manufacturer = "Egoman";
                         _pitype.processor = "BCM2835";
                      } else if (revision === "000e") {
                         _pitype.type = "Model B";
                         _pitype.rev = 2;
                         _pitype.ram = "512M";
                         _pitype.manufacturer = "Sony";
                         _pitype.processor = "BCM2835";
                      } else if (revision === "000f") {
                         _pitype.type = "Model B";
                         _pitype.rev = 2;
                         _pitype.ram = "512M";
                         _pitype.manufacturer = "Qisda";
                         _pitype.processor = "BCM2835";
                      } else if (revision === "0011" || revision === "0014") {
                         _pitype.type = "Compute Module";
                         _pitype.rev = 0;
                         _pitype.ram = "512M";
                         _pitype.processor = "BCM2835";
                      } else if (revision === "0012") {
                         _pitype.type = "Model A+";
                         _pitype.rev = 3;
                         _pitype.ram = "256M";
                         _pitype.processor = "BCM2835";
                      } else if (revision === "0010" || revision === "0013") {
                         _pitype.type = "Model B+";
                         _pitype.rev = 3;
                         _pitype.ram = "512M";
                         _pitype.processor = "BCM2835";
                      } else {  // don't know - assume revision 3 p1 connector
                         _pitype.rev = 3;
                      }
                    }
                    this._pitype = _pitype
                    let index = this._modelToType.findIndex(item => item.types.indexOf(this._pitype.type) !== -1)
                    if(index !== -1 && this._modelToType[index].supported){
                      this._pitype.gpio_type = this._modelToType[index].name
                    }
                    resolve(this._pitype)
                }
            } else {
              reject(err)
            }
        })
      }
    })
  }
}

module.exports = SettingsTTB

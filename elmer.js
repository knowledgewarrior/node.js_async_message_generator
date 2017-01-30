var util          = require('util');
var bal           = require('cloud-bal');
var _             = require('underscore');
var util          = require('util');
var elmer_service = require('./elmer.json');

var ElmerService = function(bus_access, options) {
    ElmerService.super_.call(
        this,
        bus_access,
        elmer_service,
        options);

    this.on('configured', function(config) {
        this.logger.info("GOT CONFIGURATION");
        if (config) {
            this.config = config;
        }
    });

    return this;
};

util.inherits(ElmerService, bal.Service);

module.exports = function (ctrl, options) {
    return new ElmerService(ctrl, options);
};

ElmerService.prototype.onInitialize = function (onInitialized) {
    var self = this;

    onInitialized();

    var lockFile = process.env['CLOUD_SERVICE_LOCK_FILE'];
    if (lockFile) {
        var fs = require("fs");
        fs.openSync(lockFile, 'w');
        fs.closeSync(fs.openSync(lockFile, 'w'));
    } else {
        self.logger.info("Lock file is not provided");
    }
};

ElmerService.prototype.getConfiguration = function(m, responder) {
    var self = this;
    
    self.logger.info("Client requesting configuration ");

    responder.reply(self.config);
};

ElmerService.prototype.requestRegistry = function(callback) {
    var self = this;

    var message = {
        serviceType: 'CLOUD.registry',
        op: 'getRegistry',
        serviceRealm: 'global',
        serviceVersion: 3,
        "paramSet": {}
    };

    var options = {
        timeout: 2000,
        anyCompatibleVersion: true
    };

    self.bus.advancedQuery(message, options, function(reply) {
        if (reply.errorSet) {
            self.logger.info("Error sending request for registry: %s", JSON.stringify(reply.errorSet));
            callback(reply.errorSet, null);
        } else {
            var services = reply.resultSet.registry;
            callback(null, services);
        }
    }, function() {
        self.logger.info("Timeout occurred getting registry list");
        callback("Timeout", null);
    }, function(err) {
        self.logger.info("Error occurred. Error message: " + err.errorMessage);
        callback("Error", null);
    });
};


ElmerService.prototype.fuddQuery = function(serviceType, serviceRealm, serviceVersion) {
    var self = this;

    return new Promise((resolve, reject) => {

      function randomString(length) {
        return Math.random().toString(length).slice(2);
      }

      function randomInt (low, high) {
        return Math.floor(Math.random() * (high - low) + low);
      }

      var randomMessage = randomString(randomInt(18,35));

      var message = {
        serviceType: serviceType,
        serviceRealm: serviceRealm,
        serviceVersion: serviceVersion,
        op: 'echo',
        paramSet: {
          data: {
            message: randomMessage
          }
        }
      };

      var options = {
        timeout: 30000,
        anyCompatibleVersion: true
      };

      self.bus.advancedQuery(message, options, function(reply) {
        if (reply.errorSet) {
          self.logger.info("Error received sending random data to: %s", JSON.stringify(reply.errorSet));
          reject(reply.errorSet);
          return;
        } else {
          self.logger.info("Successful ping to %s ", serviceType);
          resolve();
          return;
        }
      }, function() {
        self.logger.info("Timeout occurred sending ping to service %s", serviceType);
        reject(new Error('timeout'));
        return;
      }, function(err) {
        self.logger.info("Error occurred. Error message: " + err.errorMessage);
        reject(new Error('some other error'));
        return;
      });
    });
};

ElmerService.prototype.fuddSend = function(serviceType, serviceRealm, serviceVersion) {
    var self = this;

    return new Promise((resolve, reject) => {

      function randomString(length) {
        return Math.random().toString(length).slice(2);
      }

      function randomInt (low, high) {
        return Math.floor(Math.random() * (high - low) + low);
      }

      var randomMessage = randomString(randomInt(18,35));

      var message = {
        serviceType: serviceType,
        serviceRealm: serviceRealm,
        serviceVersion: serviceVersion,
        op: 'echo',
        paramSet: {
          data: {
            message: randomMessage
          }
        }
      };

      var options = {
        timeout: 30000,
        anyCompatibleVersion: true
      };

      self.bus.send(message, options, function(reply) {
        self.logger.info("Successful ping to %s ", serviceType);
        resolve();
        return;
      }, function() {
        self.logger.info("Timeout occurred sending ping to service %s", serviceType);
        reject(new Error('timeout'));
        return;
      }, function(err) {
        self.logger.info("Error occurred. Error message: " + err.errorMessage);
        reject(new Error('some other error'));
        return;
      });
    });
};

ElmerService.prototype.smashOne = function(m, responder) {
    var self = this;

    var smashers = parseInt(m.paramSet.smashers);
    if (isNaN(smashers) || smashers < 1 || smashers > 10000) {
        return responder.error({
            code: "INVALID_SMASHERS",
            details: "Invalid number of smashers provided:  must be between 1 and 10,000"
        });
    }
    var serviceType = String(m.paramSet.service);
    var serviceVersion = String(m.paramSet.version);
    var serviceRealm = String(m.paramSet.realm);

    var sendResponse = function(service, version, realm, smashers) {
        responder.reply({
            jobStatus: "submitted",
            service: serviceType,
            version: serviceVersion,
            realm: serviceRealm,
            smashers: smashers
        });
    };

    sendResponse(serviceType, serviceVersion, serviceRealm, smashers);

    for (i = 0; i < smashers; i++) {
        Promise.resolve(self.fuddSend(serviceType, serviceRealm, serviceVersion));
        //Promise.resolve(self.fuddQuery(serviceType, serviceRealm, serviceVersion));
    } // for i smashers
};

ElmerService.prototype.smashAll = function(m, responder) {
    var self = this;
    var smashers = parseInt(m.paramSet.smashers);
    if (isNaN(smashers) || smashers < 1 || smashers > 10000) {
        return responder.error({
            code: "INVALID_SMASHERS",
            details: "Invalid number of smashers provided:  must be between 1 and 10,000"
        });
    }    
    var sendResponse = function(serviceList) {
        responder.reply({
            jobStatus: "submitted",
            liveServices: serviceList,
            smashers: smashers
        });
    };
    self.requestRegistry(function(err, services) {
        if (!err) {
            services = services.services;
            sendResponse(_.keys(services));
        } else {
            sendResponse("Error requesting registry");
        }
    });
    //yes i'm requesting registry again until i figure out how
    // to push the list of services objects into an array and run
    // fudd on the array as a Promise.all() rather than a Promise.resolve
    // on each.
    self.requestRegistry(function(err, services) {
        if (!err) {
            services = services.services;
            for (i = 0; i < smashers; i++) {
                for (var service in services){
                    if (service === "CLOUD.elmer.service") continue; 
                    var serviceType = service;
                    var serviceVersion = _.values(services[service].latestVersions.realms)[0];
                    var serviceRealm =  _.keys(services[service].latestVersions.realms)[0];
                    Promise.resolve(self.fuddSend(serviceType, serviceRealm, serviceVersion));
                } // for service in services 
            //setTimeout(function() {}, 1)
            } // for i smashers
        } else {
            sendResponse("Error requesting registry");
        }
    });
};

/**
 * A Bot for Slack!
 */


/**
 * Define a function for initiating a conversation on installation
 * With custom integrations, we don't have a way to find out who installed us, so we can't message them :(
 */

function onInstallation(bot, installer) {
    if (installer) {
        bot.startPrivateConversation({user: installer}, function (err, convo) {
            if (err) {
                console.log(err);
            } else {
                convo.say('I am a bot that has just joined your team');
                convo.say('You must now /invite me to a channel so that I can be of use!');
            }
        });
    }
}


/**
 * Configure the persistence options
 */

var config = {};
if (process.env.MONGOLAB_URI) {
    var BotkitStorage = require('botkit-storage-mongo');
    config = {
        storage: BotkitStorage({mongoUri: process.env.MONGOLAB_URI}),
    };
} else {
    config = {
        json_file_store: ((process.env.TOKEN)?'./db_slack_bot_ci/':'./db_slack_bot_a/'), //use a different name if an app or CI 
    };
}

/**
 * Are being run as an app or a custom integration? The initialization will differ, depending
 */

if (process.env.TOKEN || process.env.SLACK_TOKEN) {
    //Treat this as a custom integration (Using this)
    var customIntegration = require('./lib/custom_integrations');
    var token = (process.env.TOKEN) ? process.env.TOKEN : process.env.SLACK_TOKEN;
    var controller = customIntegration.configure(token, config, onInstallation);

} else if (process.env.CLIENT_ID && process.env.CLIENT_SECRET && process.env.PORT) {
    //Treat this as an app
    var app = require('./lib/apps');
    var controller = app.configure(process.env.PORT, process.env.CLIENT_ID, process.env.CLIENT_SECRET, config, onInstallation);
} else {
    console.log('Error: If this is a custom integration, please specify TOKEN in the environment. If this is an app, please specify CLIENTID, CLIENTSECRET, and PORT in the environment');
    process.exit(1);
}


/**
 * A demonstration for how to handle websocket events. In this case, just log when we have and have not
 * been disconnected from the websocket. In the future, it would be super awesome to be able to specify
 * a reconnect policy, and do reconnections automatically. In the meantime, we aren't going to attempt reconnects,
 * WHICH IS A B0RKED WAY TO HANDLE BEING DISCONNECTED. So we need to fix this.
 *
 * TODO: fixed b0rked reconnect behavior
 */
// Handle events related to the websocket connection to Slack
controller.on('rtm_open', function (bot) {
    console.log('** The RTM api just connected!');
});

controller.on('rtm_close', function (bot) {
    console.log('** The RTM api just closed');
    // you may want to attempt to re-open
});


/**
 * Core bot logic goes here!
 */
const INSIDERWORDS = require('./words.json');
let GAMEINPROGRESS = false;
const GAMETIME = 5 * 60 * 1000;
var GAMETIMEOUT

controller.on('bot_channel_join', function (bot, message) {
    bot.reply(message, "HeLlO! i'M sPoNgEbOt!")
});

controller.on('event', async(bot, message) => {
    await bot.reply(message,`Received an event. ${message.type}`);
});

controller.hears('', ['mention', 'direct_mention'], function (bot, message) {
    if (message.text.toLowerCase().includes("play insider")) {
        // do insider 
        if(!GAMEINPROGRESS) {
            GAMEINPROGRESS = true;
            let players = message.text.split("@");
            players.shift();
            playInsider(players, bot, message);
        } else {
            bot.reply(message, "Error: Insider game in progress");
        }
    } else {
        // be sarcastic
        bot.reply(message, sarcasetic(message.text));
    }
});

function sarcasetic(text) {
    return text.split('').map((c,i) => 
        i % 2 == 0 ? c.toLowerCase() : c.toUpperCase()
    ).join('');   
}

function playInsider(playerArray, bot, message) {
    let max = playerArray.length;
    if (max < 3) {
        bot.reply(message, "We need more players");
    }

    let master = playerArray.splice(randomIntFromInterval(0, max - 1), 1);
    master = master.toString().split(">")[0];
    let insider = playerArray.splice(randomIntFromInterval(0, (max - 2)), 1);
    insider = insider.toString().split(">")[0];

    let insiderGame = new InsiderGame(master, insider, playerArray, GAMETIME, 0, INSIDERWORDS, message);

    // Notify the insider
    bot.startPrivateConversation(insiderGame.insidermsg, function(err, convo) {
        if (err) {
            convo.say("This is embarassing, but something has gone wrong!");
        }
        convo.say("Hello! You are the Insider for this game. The word is: " + insiderGame.word);
        convo.next();
    });

    // Start the game
    insiderGame.startGame(bot);

    //Timer
    GAMETIMEOUT = setTimeout(function(){
        bot.startConversation(insiderGame.message, function(err, convo) {
            GAMEINPROGRESS = false;
            convo.say("Times up! Game over. The secret word for this game was: " + insiderGame.word);
            insiderGame.endMasterConvo();
        })}, GAMETIME);

    // Message the master & setup end conditions
    insiderGame.contactMaster(bot);
    
}

function randomIntFromInterval(min, max) { // min and max included 
    return Math.floor(Math.random() * (max - min + 1) + min);
}

function stop() {
    console.log('Exiting bot process');
    bot.destroy();
    process.exit(1);
}

class InsiderGame {
    constructor(master, insider, players, gametime, votetime, wordData, message) {
        this.master = master;
        this.insider = insider;
        this.players = players;
        this.gametime = gametime;
        this.votetime = votetime;
        this.message = message;
        this.mastermsg = JSON.parse(JSON.stringify(message));
        this.mastermsg.user = this.master;
        this.insidermsg = JSON.parse(JSON.stringify(message));
        this.insidermsg.user = this.insider;
        this.timeStamp = new Date().getTime();
        this.masterConvo = false;
        this.chooseRandomWord(wordData);
    }

    startGame(bot) {
        let that = this;
        bot.startConversation(this.message, function(err, convo) {
            if (!err) {
                convo.say("Welcome to Insider");
                convo.say("The Master for this game is: <@" + that.master + ">");
                convo.say("The Insider knows who they are... The game starts now! You have 5 minutes.");
                } else {
                    console.log(err);
                }
        });   
    }

    contactMaster(bot) {
        let that = this;
        bot.startPrivateConversation(this.mastermsg, function(err, convo) {
            if (err) { 
                convo.say("This is embarassing, but something has gone wrong!");
            }
            convo.say("Hello! You are the Master for this game. The word is: " + that.word);
            that.masterConvo = convo;
            convo.on('end', function(convo) {
                if (convo.status == 'completed') {
                    // End the first part of the game
                    clearTimeout(GAMETIMEOUT);
                    let endTime = new Date().getTime();
                    let timeExpired = new Date(endTime - that.timeStamp).getSeconds();

                    bot.startConversation(that.message, function(err, convo) {
                        convo.say('Congratulations. You correctly guessed the word in ' + timeExpired + ' seconds. You will have that much time to identify the insider.');
                    // Pass game logic to Insider guess thing
                    that.accuseInsider(bot, timeExpired);
                    })
                    
                } else {
                    GAMEINPROGRESS = false;
                    bot.reply(that.message, "The game has ended");
                    clearTimeout(GAMETIMEOUT);
                }
            });
            convo.ask("If the participants guess the word please respond STOP in this thread. To cancel the game respond QUIT in this thread.", [
                {
                    pattern: 'stop',
                    callback: function(response,convo) {
                        convo.say('Ok!');
                        convo.next();
                      }
                },
                {
                    pattern: 'quit',
                    callback: function(response, convo) {
                        convo.say('Terminating game.');
                        convo.stop();
                    }
                },
                {
                    default: true,
                    callback: function(response, convo) {
                        convo.repeat();
                        convo.next();
                    }
                }
            ]);
        });
    }

    accuseInsider(bot, time) {
        let that = this;
        let msgCopy = JSON.parse(JSON.stringify(message))
        let timeout = setTimeout(function(){
            bot.startConversation(that.message, function(err, convo) {
                GAMEINPROGRESS = false;
                convo.ask("Times up! Game over. Do you want to know the identity of the insider? Yes or No.", [
                    {
                        pattern: 'yes',
                        callback: function(response,convo) {
                            convo.say('Great! The insider for this game was <@' + that.insider + '>!');
                            convo.next();
                          }
                    },
                    {
                        pattern: 'No',
                        callback: function(response, convo) {
                            convo.say('Ok. HoPe It WaS fUn!');
                            convo.stop();
                        }
                    },
                    {
                        default: true,
                        callback: function(response, convo) {
                            convo.say(sarcasetic("that wasn't yes or no! goodbye."));
                            convo.next();
                        }
                    }
                ]);
                //insiderGame.endMasterConvo();
            })}, (time * 1000));
        // Tally votes
        /*
        this.playerArray.forEach((element) =>{
            msgCopy.user = element;
            // TODO: Wrap all in a promise, tally votes in promise.all and determine who was the insider.
            let myPromise = new Promise(function(resolve, reject) {
                bot.startPrivateConversation(msgCopy, function(err, convo) {
                    convo.on('end', function(convo) {
                        promise1.resolve()
                    }); 
                });
            });
        });
        */
    }

    chooseRandomWord(collection) {
        let max = collection.words.length;
        this.word = collection.words.splice(randomIntFromInterval(0, max - 1), 1)

    }

    endMasterConvo() {
        if (this.masterConvo) {
            this.masterConvo.stop();
            this.masterConvo = false;
        }
    }
}

/**
 * AN example of what could be:
 * Any un-handled direct mention gets a reaction and a pat response!
 */
//controller.on('direct_message,mention,direct_mention', function (bot, message) {
//    bot.api.reactions.add({
//        timestamp: message.ts,
//        channel: message.channel,
//        name: 'robot_face',
//    }, function (err) {
//        if (err) {
//            console.log(err)
//        }
//        bot.reply(message, 'I heard you loud and clear boss.');
//    });
//});

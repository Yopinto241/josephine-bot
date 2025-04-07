const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

// Store conversation state for each user
const conversationState = new Map();
// Owner's WhatsApp number (set via environment variable on Render)
const OWNER_NUMBER = process.env.OWNER_NUMBER || 'YOUR_NUMBER@s.whatsapp.net'; // e.g., "255617513064@s.whatsapp.net"

async function startSock() {
    const authDir = process.env.AUTH_DIR || './auth_info'; // Use env var for Render or default locally
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        browser: ['Josephine', 'Chrome', '1.0'],
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('📲 Scan this QR code to connect Josephine:');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const shouldReconnect = new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('❌ Connection closed:', lastDisconnect?.error, 'Reconnecting:', shouldReconnect);
            if (shouldReconnect) startSock();
        } else if (connection === 'open') {
            console.log('✅ Josephine is online! 🚀');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;

        const sender = msg.key.remoteJid;
        const isFromMe = msg.key.fromMe;

        // Ignore groups and status updates
        if (sender === 'status@broadcast' || sender.includes('@g.us')) {
            console.log(`Ignoring message from ${sender} (group or status)`);
            return;
        }

        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').toLowerCase();
        console.log(`📩 [${sender}] Received: "${text}" From me: ${isFromMe}`);

        let userState = conversationState.get(sender) || {
            step: 0,
            invalidCount: 0,
            branch: null,
            paused: false,
            cooldownUntil: null,
            lastMessageSent: false,
        };

        // Owner interruption
        if (isFromMe && sender === OWNER_NUMBER) {
            userState.paused = true;
            await sock.sendMessage(sender, { text: "👋 I’ve paused Josephine to let you take over! Use 'resume' to bring me back." });
            console.log(`🛑 Paused bot for ${sender} due to owner interruption`);
            conversationState.set(sender, userState);
            return;
        }

        // If paused, check for resume command
        if (userState.paused) {
            if (text === 'resume' && isFromMe && sender === OWNER_NUMBER) {
                userState.paused = false;
                await sock.sendMessage(sender, { text: "▶️ Josephine is back online! How can I assist you now?" });
                console.log(`▶️ Resumed bot for ${sender}`);
            } else {
                console.log(`⏸️ Bot paused for ${sender}, waiting for owner to resume`);
                return;
            }
        }

        // Check cooldown
        if (userState.cooldownUntil) {
            const now = Date.now();
            if (now < userState.cooldownUntil) {
                console.log(`⏳ ${sender} on cooldown until ${new Date(userState.cooldownUntil).toISOString()}`);
                return;
            } else {
                userState.step = 0;
                userState.branch = null;
                userState.cooldownUntil = null;
                userState.lastMessageSent = false;
                console.log(`🔄 Cooldown expired for ${sender}, resetting state`);
            }
        }

        // Skip bot-sent messages
        if (isFromMe) {
            console.log(`Skipping bot-sent message for ${sender}`);
            return;
        }

        // Handle user responses
        if (userState.lastMessageSent) {
            const expectedResponses = {
                1: ['yes', 'yep', 'wait'],
                2: ['yes', 'yep'],
                3: ['yes', 'yep'],
                4: ['business', 'fun'],
                5: ['yes', 'yep'],
                6: ['yes', 'yep'],
                7: ['yes', 'yep'],
                8: ['yes', 'yep'],
                9: ['yes', 'yep'],
                10: ['yes', 'yep'],
                11: ['yes', 'yep'],
                12: ['yes', 'yep'],
                13: ['yes', 'yep'],
                14: ['yes', 'yep'],
                15: ['thanks'],
            };

            if (expectedResponses[userState.step] && !expectedResponses[userState.step].includes(text)) {
                userState.invalidCount += 1;
                if (userState.invalidCount >= 3) {
                    await sock.sendMessage(sender, {
                        text: "🤔 It seems we’re not quite aligned! I’m Josephine—let’s start fresh.\nPlease reply with ‘yes’ to continue or ‘wait’ to reach Yopinto directly."
                    });
                    userState.step = 1;
                    userState.invalidCount = 0;
                    userState.branch = null;
                } else {
                    await sock.sendMessage(sender, {
                        text: `❌ I didn’t catch that! Please respond with ‘${expectedResponses[userState.step][0]}’ to proceed.`
                    });
                }
                userState.lastMessageSent = true;
                conversationState.set(sender, userState);
                return;
            }

            userState.invalidCount = 0;
        }

        // Process steps
        if (!userState.lastMessageSent || userState.step > 0) {
            switch (userState.step) {
                case 0:
                    await sock.sendMessage(sender, {
                        text: "👋 Greetings! I’m Josephine, your dedicated assistant, crafted by the exceptional Yopinto.\n\n" +
                              "Yopinto is a visionary expert in:\n" +
                              "🌐 Crafting elegant, high-performing websites that captivate.\n" +
                              "📱 Developing innovative apps tailored to your needs.\n" +
                              "📈 Designing strategic business solutions for growth.\n" +
                              "📣 Creating impactful advertising campaigns that shine.\n" +
                              "💻 Offering insightful computing advice to solve challenges.\n\n" +
                              "I’m here to assist you with his top-tier services. How may I support you today?"
                    });
                    await sock.sendMessage(sender, {
                        text: "🤝 Would you like to explore my capabilities, or connect with Yopinto personally?\n" +
                              "Please reply with ‘yes’ to continue with me, or ‘wait’ to reach Yopinto."
                    });
                    userState.step = 1;
                    userState.lastMessageSent = true;
                    break;
                case 1:
                    if (text === 'yes' || text === 'yep') {
                        await sock.sendMessage(sender, {
                            text: "🎉 Excellent choice! I’m excited to assist you.\n" +
                                  "Are you curious about the inspiration behind my name, Josephine?\n" +
                                  "Please reply with ‘yes’ to find out!"
                        });
                        userState.step = 2;
                    } else if (text === 'wait') {
                        await sock.sendMessage(sender, {
                            text: "✅ No problem! I’m notifying Yopinto to bring his expertise your way.\n" +
                                  "He’ll reach out soon—feel free to check back in 2 hours if needed!"
                        });
                        userState.cooldownUntil = Date.now() + 2 * 60 * 60 * 1000; // 2 hours
                    }
                    userState.lastMessageSent = true;
                    break;
                case 2:
                    await sock.sendMessage(sender, {
                        text: "🙌 Thank you for your interest! My name’s origin is a mystery—perhaps a tribute to someone special to Yopinto.\n" +
                              "Would you like to learn how a custom bot like me can enhance your WhatsApp experience?\n" +
                              "Please reply with ‘yes’ to explore more!"
                    });
                    userState.step = 3;
                    userState.lastMessageSent = true;
                    break;
                case 3:
                    await sock.sendMessage(sender, {
                        text: "🌟 Wonderful! I’m built to elevate your communication.\n" +
                              "Are you looking for a bot for business efficiency or personal enjoyment?\n" +
                              "Please reply with ‘business’ or ‘fun’ to choose."
                    });
                    userState.step = 4;
                    userState.lastMessageSent = true;
                    break;
                case 4:
                    if (text === 'business') {
                        userState.branch = 'business';
                        await sock.sendMessage(sender, {
                            text: "📊 A strategic choice! Businesses flourish with automation like me.\n" +
                                  "I optimize client interactions, save time, and boost revenue.\n" +
                                  "Want to know how? Please reply with ‘yes’!"
                        });
                    } else if (text === 'fun') {
                        userState.branch = 'fun';
                        await sock.sendMessage(sender, {
                            text: "😊 A delightful pick! I bring joy and engagement to your chats.\n" +
                                  "Curious why I’m so entertaining? Please reply with ‘yes’!"
                        });
                    }
                    userState.step = 5;
                    userState.lastMessageSent = true;
                    break;
                case 5:
                    if (userState.branch === 'business') {
                        await sock.sendMessage(sender, {
                            text: "🚀 Here’s how I empower businesses:\n" +
                                  "• Instant client responses.\n" +
                                  "• Enhanced satisfaction and loyalty.\n" +
                                  "• 24/7 availability.\n" +
                                  "Interested in the benefits? Reply with ‘yes’!"
                        });
                    } else {
                        await sock.sendMessage(sender, {
                            text: "🎈 Here’s what makes me fun:\n" +
                                  "• Engaging chats that spark joy.\n" +
                                  "• Unique flair for lively talks.\n" +
                                  "• A companion for great moments.\n" +
                                  "Want more perks? Reply with ‘yes’!"
                        });
                    }
                    userState.step = 6;
                    userState.lastMessageSent = true;
                    break;
                case 6:
                    if (userState.branch === 'business') {
                        await sock.sendMessage(sender, {
                            text: "📈 The results speak for themselves:\n" +
                                  "• Attract more clients effortlessly.\n" +
                                  "• Project professionalism with ease.\n" +
                                  "• Increase revenue seamlessly.\n" +
                                  "More benefits? Reply with ‘yes’!"
                        });
                    } else {
                        await sock.sendMessage(sender, {
                            text: "✨ The perks are exciting:\n" +
                                  "• Daily engaging conversations.\n" +
                                  "• Stand out with charm.\n" +
                                  "• Create a buzz in your chats.\n" +
                                  "More details? Reply with ‘yes’!"
                        });
                    }
                    userState.step = 7;
                    userState.lastMessageSent = true;
                    break;
                case 7:
                    if (userState.branch === 'business') {
                        await sock.sendMessage(sender, {
                            text: "💼 Here’s the value:\n" +
                                  "• Cost-effective over staff.\n" +
                                  "• Quick setup, instant results.\n" +
                                  "• Outshines traditional ads.\n" +
                                  "Curious about pricing? Reply with ‘yes’!"
                        });
                    } else {
                        await sock.sendMessage(sender, {
                            text: "🎉 Why it’s a win:\n" +
                                  "• Affordable chat enhancement.\n" +
                                  "• Unique presence in your circle.\n" +
                                  "• Engaging at your fingertips.\n" +
                                  "Want the cost? Reply with ‘yes’!"
                        });
                    }
                    userState.step = 8;
                    userState.lastMessageSent = true;
                    break;
                case 8:
                    if (userState.branch === 'business') {
                        await sock.sendMessage(sender, {
                            text: "💰 Just 20,000 TSH for a business bot!\n" +
                                  "A smart investment for growth.\n" +
                                  "Want success stories? Reply with ‘yes’!"
                        });
                    } else {
                        await sock.sendMessage(sender, {
                            text: "💸 Only 5,000 TSH for a fun bot!\n" +
                                  "A small price to shine in chats.\n" +
                                  "Hear success tales? Reply with ‘yes’!"
                        });
                    }
                    userState.step = 9;
                    userState.lastMessageSent = true;
                    break;
                case 9:
                    if (userState.branch === 'business') {
                        await sock.sendMessage(sender, {
                            text: "🏆 A retailer doubled orders in a week with me!\n" +
                                  "Clients loved the prompt service.\n" +
                                  "Another example? Reply with ‘yes’!"
                        });
                    } else {
                        await sock.sendMessage(sender, {
                            text: "🌟 A user became the chat star with me!\n" +
                                  "Friends loved the daily fun.\n" +
                                  "More stories? Reply with ‘yes’!"
                        });
                    }
                    userState.step = 10;
                    userState.lastMessageSent = true;
                    break;
                case 10:
                    if (userState.branch === 'business') {
                        await sock.sendMessage(sender, {
                            text: "☕ A café saved hours daily with my order management!\n" +
                                  "Sales soared with happy customers.\n" +
                                  "How it works? Reply with ‘yes’!"
                        });
                    } else {
                        await sock.sendMessage(sender, {
                            text: "💖 A user connected meaningfully with my charm!\n" +
                                  "Chats led to great outcomes.\n" +
                                  "The approach? Reply with ‘yes’!"
                        });
                    }
                    userState.step = 11;
                    userState.lastMessageSent = true;
                    break;
                case 11:
                    if (userState.branch === 'business') {
                        await sock.sendMessage(sender, {
                            text: "🛠️ It’s simple:\n" +
                                  "• Always on for clients.\n" +
                                  "• Build trust effortlessly.\n" +
                                  "• Drive profits automatically.\n" +
                                  "More insights? Reply with ‘yes’!"
                        });
                    } else {
                        await sock.sendMessage(sender, {
                            text: "😄 It’s easy:\n" +
                                  "• Fresh, engaging chats.\n" +
                                  "• Boost your presence.\n" +
                                  "• Rewarding interactions.\n" +
                                  "More benefits? Reply with ‘yes’!"
                        });
                    }
                    userState.step = 12;
                    userState.lastMessageSent = true;
                    break;
                case 12:
                    if (userState.branch === 'business') {
                        await sock.sendMessage(sender, {
                            text: "🌍 Imagine: Competitors lag while you thrive.\n" +
                                  "I handle it all with precision.\n" +
                                  "A unique edge? Reply with ‘yes’!"
                        });
                    } else {
                        await sock.sendMessage(sender, {
                            text: "👑 Picture: Your chats outshine others.\n" +
                                  "I make you the focal point.\n" +
                                  "A special twist? Reply with ‘yes’!"
                        });
                    }
                    userState.step = 13;
                    userState.lastMessageSent = true;
                    break;
                case 13:
                    if (userState.branch === 'business') {
                        await sock.sendMessage(sender, {
                            text: "📢 One business retained clients with my flair!\n" +
                                  "Sales grew with deeper engagement.\n" +
                                  "Ready to start? Reply with ‘yes’!"
                        });
                    } else {
                        await sock.sendMessage(sender, {
                            text: "💬 One user built lasting ties with my wit!\n" +
                                  "Chats became rewarding.\n" +
                                  "Ready to go? Reply with ‘yes’!"
                        });
                    }
                    userState.step = 14;
                    userState.lastMessageSent = true;
                    break;
                case 14:
                    if (userState.branch === 'business') {
                        await sock.sendMessage(sender, {
                            text: "🏁 Final advantage:\n" +
                                  "• Stand out effortlessly.\n" +
                                  "• Grow with proven results.\n" +
                                  "• Simplify with confidence.\n" +
                                  "Join now? Reply with ‘yes’!"
                        });
                    } else {
                        await sock.sendMessage(sender, {
                            text: "🎯 Closing benefit:\n" +
                                  "• Elevate your presence.\n" +
                                  "• Delight contacts consistently.\n" +
                                  "• Enjoy exceptional chats.\n" +
                                  "Begin now? Reply with ‘yes’!"
                        });
                    }
                    userState.step = 15;
                    userState.lastMessageSent = true;
                    break;
                case 15:
                    if (userState.branch === 'business') {
                        await sock.sendMessage(sender, {
                            text: "🎉 Fantastic! Visit https://yopinto241.github.io/yopinto.github.io/\n" +
                                  "Secure your business bot for 20,000 TSH!\n" +
                                  "Say ‘thanks’ to wrap up!"
                        });
                    } else {
                        await sock.sendMessage(sender, {
                            text: "🌟 Excellent! Visit https://yopinto241.github.io/yopinto.github.io/\n" +
                                  "Get your fun bot for 5,000 TSH!\n" +
                                  "Say ‘thanks’ to finish!"
                        });
                    }
                    userState.step = 16;
                    userState.lastMessageSent = true;
                    break;
                case 16:
                    await sock.sendMessage(sender, {
                        text: "🙏 Thank you for your time! I’m Josephine, and it’s been a pleasure.\n" +
                              "Reach out again in 2 hours for more support! 🌟"
                    });
                    userState.step = 0;
                    userState.branch = null;
                    userState.cooldownUntil = Date.now() + 2 * 60 * 60 * 1000; // 2 hours
                    userState.lastMessageSent = true;
                    console.log(`⏳ Cooldown set for ${sender} until ${new Date(userState.cooldownUntil).toISOString()}`);
                    break;
            }
        }

        conversationState.set(sender, userState);
    });
}

startSock();
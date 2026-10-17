'use strict';
const { MessageEmbed } = require('discord.js');
const db = require('quick.db');

function welcomeDm(member, config) {
  const embed = new MessageEmbed()
    .setColor('GREEN')
    .setTitle('Assalamu Alaikum')
    .setURL(config.bot.guildVanityURL)
    .setDescription(`Welcome to the official ${member.guild.name} We are glad to see you here. 😊 \n\n\`Please follow these simple steps:\` \n\n\`1.\` **Take on your preferred self-role** <#${config.channels.selfRolesChannel}>\n\`2.\` **Read and comply with server rules** <#${config.channels.rules}>\n\`3.\` **Feel free to engage in chat discussions** <#${config.channels.chat}>\n\nThank you and have a good day!`)
    .setImage(config.welcomeDm.image)
    .setTimestamp()
    .setFooter(config.bot.footer, config.welcomeDm.footerIcon);
  return member.send(embed).catch(() => {});
}

module.exports = (bus, { config }, name) => {
  bus.on('guildMemberAdd', `${name}:welcome-dm`, (member) => config.welcomeDm.enabled && welcomeDm(member, config));
  // A jailed member who leaves and rejoins goes straight back to jail.
  bus.on('guildMemberAdd', `${name}:jail`, (member) => db.get(`jail.${member.id}`) && member.roles.add(config.penals.jail.roles).catch(() => {}));
};
module.exports.welcomeDm = welcomeDm;

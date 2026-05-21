import 'dotenv/config';

import {
  ChannelType,
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  OverwriteType,
  REST,
  Routes,
  SlashCommandBuilder
} from 'discord.js';

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error('.env dosyasında DISCORD_TOKEN ve CLIENT_ID olmalı.');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const PERMISSION_MAP = {
  ViewChannel: PermissionsBitField.Flags.ViewChannel,
  SendMessages: PermissionsBitField.Flags.SendMessages,
  ReadMessageHistory: PermissionsBitField.Flags.ReadMessageHistory,
  Connect: PermissionsBitField.Flags.Connect,
  Speak: PermissionsBitField.Flags.Speak,
  ManageChannels: PermissionsBitField.Flags.ManageChannels,
  ManageRoles: PermissionsBitField.Flags.ManageRoles,
  BanMembers: PermissionsBitField.Flags.BanMembers,
  KickMembers: PermissionsBitField.Flags.KickMembers,
  ManageMessages: PermissionsBitField.Flags.ManageMessages,
  AttachFiles: PermissionsBitField.Flags.AttachFiles,
  EmbedLinks: PermissionsBitField.Flags.EmbedLinks,
  AddReactions: PermissionsBitField.Flags.AddReactions
};

function toPerms(list = []) {
  return list.map(p => PERMISSION_MAP[p]).filter(Boolean);
}

function toChannelType(type) {
  if (type === 'category') return ChannelType.GuildCategory;
  if (type === 'voice') return ChannelType.GuildVoice;
  return ChannelType.GuildText;
}

function makeOverwrites(guild, rolesByName, overwrites = []) {
  return overwrites.map(ow => {
    let id = ow.target === '@everyone' ? guild.roles.everyone.id : rolesByName[ow.target]?.id;
    if (!id) return null;

    return {
      id,
      type: OverwriteType.Role,
      allow: toPerms(ow.allow || []),
      deny: toPerms(ow.deny || [])
    };
  }).filter(Boolean);
}

async function cleanGuild(guild) {
  for (const channel of guild.channels.cache.values()) {
    try { await channel.delete('Template kurulumu için temizlendi.'); } catch {}
  }

  for (const role of guild.roles.cache.values()) {
    if (role.name !== '@everyone' && role.editable) {
      try { await role.delete('Template kurulumu için temizlendi.'); } catch {}
    }
  }
}

async function installTemplate(guild, template) {
  await cleanGuild(guild);

  if (template.name) await guild.setName(template.name).catch(() => {});

  const rolesByName = {};

  for (const roleData of [...(template.roles || [])].reverse()) {
    const role = await guild.roles.create({
      name: roleData.name,
      permissions: toPerms(roleData.permissions || []),
      hoist: roleData.hoist || false,
      mentionable: roleData.mentionable || false,
      color: roleData.color || 0
    });
    rolesByName[roleData.name] = role;
  }

  try {
    await guild.roles.setPositions(
      (template.roles || []).map((r, index) => ({
        role: rolesByName[r.name],
        position: template.roles.length - index
      })).filter(x => x.role)
    );
  } catch {}

  for (const categoryData of template.categories || []) {
    const category = await guild.channels.create({
      name: categoryData.name,
      type: ChannelType.GuildCategory,
      permissionOverwrites: makeOverwrites(guild, rolesByName, categoryData.overwrites || [])
    });

    for (const channelData of categoryData.channels || []) {
      await guild.channels.create({
        name: channelData.name,
        type: toChannelType(channelData.type),
        parent: category.id,
        topic: channelData.topic || undefined,
        permissionOverwrites: channelData.overwrites
          ? makeOverwrites(guild, rolesByName, channelData.overwrites)
          : undefined
      });
    }
  }
}

client.once('clientReady', async () => {
  console.log(`${client.user.tag} aktif.`);

  const commands = [
    new SlashCommandBuilder()
      .setName('setup')
      .setDescription('JSON template dosyasını sunucuya kurar.')
      .addAttachmentOption(option =>
        option
          .setName('dosya')
          .setDescription('Kurulacak JSON template dosyası')
          .setRequired(true)
      )
  ].map(command => command.toJSON());

  const rest = new REST({ version: '10' }).setToken(TOKEN);

  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('Slash komutları kaydedildi. Komut: /setup');
  } catch (error) {
    console.error(error);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'setup') return;

  const guild = interaction.guild;
  const attachment = interaction.options.getAttachment('dosya');

  if (!guild) return interaction.reply({ content: 'Bu komut sadece sunucuda kullanılabilir.', ephemeral: true });

  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
    return interaction.reply({ content: 'Bu komutu kullanmak için Yönetici iznin olmalı.', ephemeral: true });
  }

  if (!attachment.name.endsWith('.json')) {
    return interaction.reply({ content: 'Sadece .json template dosyası yükle.', ephemeral: true });
  }

  await interaction.reply('Template dosyası alındı. Sunucu temizlenip kuruluyor...');

  try {
    const response = await fetch(attachment.url);
    const template = await response.json();
    await installTemplate(guild, template);
    await interaction.followUp('Kurulum tamamlandı.');
  } catch (error) {
    console.error(error);
    await interaction.followUp('Kurulum sırasında hata oluştu. JSON formatını kontrol et.');
  }
});

client.login(TOKEN);

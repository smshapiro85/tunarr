# Properties

Choose a channel a name. Optionally, you can also add a thumbnail by uploading an image or providing an image URL. This will be the logo visible within your IPTV client's channel guide. Transparent .png files are supported. 

## Channel Icon

The channel icon has three states:

- **Custom icon** -- Upload an image or provide a URL. This image appears in your IPTV client's channel guide, watermark overlays, and the Tunarr UI.
- **Default logo** -- When no custom icon is set, Tunarr shows its default logo as a fallback. This is the default behavior.
- **No icon** -- Click the **X** button next to the icon preview to remove the icon entirely. In this state, no icon is included in the M3U playlist, XMLTV guide data, or watermark overlay. To restore the default logo after removing the icon, click the **restore** button.

On-Demand will allow your channels to behave similar to streaming services, where the watch states will only progress while you're actively viewing the channel. This is disabled by default, which means by default channels will behave similar to traditional televison where watch states will progress without you actively viewing the channel.

## Single Show Channel

Channels dedicated to a single show repeat that show's name in guide clients: once as the channel name, and again as the title of every program. A channel named "Bluey" ends up reading "Bluey / Bluey" in an IPTV app rather than telling you which episode is on.

Turn on **Single Show Channel** and the [EPG](/configure/channels/epg) uses the episode title as the program title instead, so the guide reads "Bluey / Sleepytime". Season and episode numbers, descriptions, artwork, and every other piece of guide metadata are unchanged.

Leave this off for channels that mix several shows -- there, the show name is what distinguishes one program from the next, and the episode title is shown as a sub-title underneath it.

The setting only affects episodes. Movies, music videos, and tracks on the channel are titled the same way either way.

!!! info
    When upgrading, Tunarr enables this automatically for any existing channel whose programming comes from exactly one show. You can turn it back off per channel at any time.

![Channel properties](/assets/channel-properties.png)

Click the ["FLEX" tab](/configure/channels/flex) if you'd like to configure optional filler content to play in-between episodes. 
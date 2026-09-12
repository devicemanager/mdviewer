// :shortcode: -> Unicode emoji conversion, ported 1:1 from mdviewer.js.

export const emojiMap: Record<string, string> = {
    "+1": "👍", "-1": "✖️", white_check_mark: "✔️", grinning: "😀",
    smiley: "😃", smile: "😄", grin: "😁", laughing: "😆",
    sweat_smile: "😅", joy: "😂", wink: "😉", blush: "😊", yum: "😋",
    sunglasses: "😎", heart: "❤", orange_heart: "🧡", yellow_heart: "💛",
    green_heart: "💚", blue_heart: "💙", purple_heart: "💜",
    broken_heart: "💔", thinking: "🤔", neutral_face: "😐",
    expressionless: "😑", no_mouth: "😶", smirk: "😏", unamused: "😒",
    sweat: "😓", pensive: "😔", confused: "😕", confounded: "😖",
    kissing: "😗", kissing_heart: "😘", kissing_smiling_eyes: "😙",
    kissing_closed_eyes: "😚", stuck_out_tongue: "😛",
    stuck_out_tongue_winking_eye: "😜",
    stuck_out_tongue_closed_eyes: "😝", angry: "😠", rage: "😡",
    cry: "😢", persevere: "😣", triumph: "😤", disappointed: "😥",
    worried: "😟", zealous: "🥺", imp: "👿", skull: "💀",
    ghost: "👻", alien: "👽", robot: "🤖", poop: "💩",
    shushing_face: "🤭", notes: "🎶", muscle: "💪", hand_wave: "👋",
    raised_hands: "🙌", clap: "👏", writing_hand: "✍", pray: "🙏",
    rocket: "🚀", check_mark_button: "✔️", fire: "🔥",
    sparkles: "✨", star: "⭐", sunrise_over_mountains: "🌅",
    snowflake: "❄️", zap: "⚡", evergreen_tree: "🌲",
    deciduous_tree: "🌳", flower: "🌸", coffee: "☕", pizza: "🍕",
    beer: "🍺", musical_note: "🎵", calendar: "📅", lightbulb: "💡",
    email: "✉️", link: "🔗", eye: "👁", thumbs_up: "👍",
    thumbs_down: "👎", warning: "⚠️", lock: "🔒", open_lock: "🔓",
    gear: "⚙️", bookmark: "🔖", wrench: "🔧", clipboard: "📋",
    chart_with_upwards_trend: "📈", pencil: "✏️", package: "📦",
    telescope: "🔭", bell: "🔔", key: "🔑", money_with_wings: "💸",
    gift: "🎁", confetti_ball: "🎉", trophy: "🏆", medal: "🏅",
    megaphone: "📢", inbox_tray: "📥", telephone_receiver: "☎️",
    mobile_phone: "📱", laptop: "💻", desktop_computer: "🖥️",
    printer: "🖨️", keyboard: "⌨️", game_die: "🎲",
    watch: "⌚", tv: "📺", camera: "📷", movie_camera: "🎬",
    globe_showing_americas: "🌎", map: "🗺️", compass: "🧭",
};

/**
 * Replace known :shortcode: sequences with their Unicode emoji. Unknown codes
 * are left untouched.
 */
export function resolveEmoji(str: string): string {
    // The shortcode body allows word characters plus '+' and '-' so common
    // GitHub codes like ':+1:' and ':-1:' resolve (the old /\w[\w+]*/ pattern
    // required a leading word char and silently dropped those).
    return str.replace(/:([\w+-]+):/g, function (match, code: string) {
        return emojiMap[code] || match;
    });
}

/**
 * Emoji picker dataset.
 * Nine categories and search (`Search emojis...`), with each button's `aria-label` set to its
 * emoji name (such as "Star-struck"). Search matches these names. Keep a manually curated set
 * instead of adding an emoji package to avoid dependencies and bundle growth.
 */

export type EmojiItem = { e: string; n: string };
export type EmojiCategory = { id: string; label: string; items: EmojiItem[] };

const c = (id: string, label: string, pairs: string): EmojiCategory => ({
  id,
  label,
  items: pairs
    .trim()
    .split('\n')
    .map((line) => {
      const [e, ...rest] = line.trim().split(' ');
      return { e, n: rest.join(' ') };
    })
    .filter((x) => x.e),
});

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  c(
    'smileys',
    'Smileys & emotion',
    `
😀 grinning face
😃 grinning face big eyes
😄 grinning face smiling eyes
😁 beaming face
😆 grinning squinting
😅 grinning sweat
🤣 rolling on the floor
😂 tears of joy
🙂 slightly smiling
🙃 upside down
😉 winking face
😊 smiling blush
😇 halo angel
🥰 smiling hearts
😍 heart eyes
🤩 star struck
😘 blowing a kiss
😗 kissing face
😚 kissing closed eyes
😙 kissing smiling eyes
🥲 smiling tear
😋 savoring food
😛 tongue out
😜 winking tongue
🤪 zany face
😝 squinting tongue
🤑 money mouth
🤗 hugging face
🤭 hand over mouth
🤫 shushing face
🤔 thinking face
🤐 zipper mouth
🤨 raised eyebrow
😐 neutral face
😑 expressionless
😶 no mouth
😏 smirking face
😒 unamused
🙄 rolling eyes
😬 grimacing
🤥 lying face
😌 relieved
😔 pensive
😪 sleepy
🤤 drooling
😴 sleeping
😷 medical mask
🥵 hot face
🥶 cold face
🥴 woozy face
😵 dizzy face
🤯 exploding head
🤠 cowboy hat
🥳 partying face
😎 sunglasses
🤓 nerd face
🧐 monocle
😕 confused
😟 worried
🙁 slightly frowning
😮 open mouth
😯 hushed
😲 astonished
😳 flushed
🥺 pleading
😦 frowning open
😧 anguished
😨 fearful
😰 anxious sweat
😥 sad relieved
😢 crying
😭 loudly crying
😱 screaming fear
😖 confounded
😣 persevering
😞 disappointed
😓 downcast sweat
😩 weary
😫 tired face
🥱 yawning
😤 steam from nose
😡 pouting rage
😠 angry
🤬 cursing
😈 smiling devil
👿 angry devil
💀 skull
💩 pile of poo
🤡 clown
👻 ghost
👽 alien
🤖 robot
`,
  ),
  c(
    'people',
    'People & body',
    `
👋 waving hand
🤚 raised back of hand
🖐 hand fingers splayed
✋ raised hand
🖖 vulcan salute
👌 ok hand
🤌 pinched fingers
🤏 pinching hand
✌️ victory hand
🤞 crossed fingers
🤟 love you gesture
🤘 sign of the horns
🤙 call me hand
👈 pointing left
👉 pointing right
👆 pointing up
👇 pointing down
☝️ index pointing up
👍 thumbs up
👎 thumbs down
✊ raised fist
👊 oncoming fist
🤛 left facing fist
🤜 right facing fist
👏 clapping hands
🙌 raising hands
👐 open hands
🤲 palms up
🤝 handshake
🙏 folded hands
💪 flexed biceps
🦾 mechanical arm
🦿 mechanical leg
👀 eyes
🧠 brain
👣 footprints
🫀 anatomical heart
👶 baby
🧒 child
👦 boy
👧 girl
🧑 person
👨 man
👩 woman
🧓 older person
👴 old man
👵 old woman
🕺 man dancing
💃 woman dancing
🧘 person in lotus
🏃 person running
🚶 person walking
`,
  ),
  c(
    'animals',
    'Animals & nature',
    `
🐶 dog face
🐱 cat face
🐭 mouse face
🐹 hamster
🐰 rabbit face
🦊 fox
🐻 bear
🐼 panda
🐨 koala
🐯 tiger face
🦁 lion
🐮 cow face
🐷 pig face
🐸 frog
🐵 monkey face
🙈 see no evil
🙉 hear no evil
🙊 speak no evil
🐒 monkey
🐔 chicken
🐧 penguin
🐦 bird
🐤 baby chick
🦆 duck
🦅 eagle
🦉 owl
🦇 bat
🐺 wolf
🐗 boar
🐴 horse face
🦄 unicorn
🐝 honeybee
🐛 bug
🦋 butterfly
🐌 snail
🐞 lady beetle
🐜 ant
🦂 scorpion
🐢 turtle
🐍 snake
🦎 lizard
🐙 octopus
🦑 squid
🦐 shrimp
🦞 lobster
🦀 crab
🐠 tropical fish
🐟 fish
🐬 dolphin
🐳 spouting whale
🦈 shark
🐊 crocodile
🐅 tiger
🦓 zebra
🦍 gorilla
🐘 elephant
🦛 hippopotamus
🦏 rhinoceros
🐪 camel
🦒 giraffe
🦘 kangaroo
🐄 cow
🐖 pig
🐑 ewe
🦙 llama
🐕 dog
🐈 cat
🦔 hedgehog
🦥 sloth
🦦 otter
🦨 skunk
🌵 cactus
🌲 evergreen tree
🌳 deciduous tree
🌴 palm tree
🌱 seedling
🍀 four leaf clover
🍁 maple leaf
🍂 fallen leaf
🍃 leaf fluttering
🌺 hibiscus
🌸 cherry blossom
🌼 blossom
🌻 sunflower
🌹 rose
🌷 tulip
🌍 globe europe africa
🌙 crescent moon
⭐ star
🌟 glowing star
✨ sparkles
⚡ high voltage
🔥 fire
💧 droplet
🌊 water wave
🌈 rainbow
☀️ sun
☁️ cloud
❄️ snowflake
`,
  ),
  c(
    'food',
    'Food & drink',
    `
🍏 green apple
🍎 red apple
🍐 pear
🍊 tangerine
🍋 lemon
🍌 banana
🍉 watermelon
🍇 grapes
🍓 strawberry
🫐 blueberries
🍈 melon
🍒 cherries
🍑 peach
🥭 mango
🍍 pineapple
🥥 coconut
🥝 kiwi fruit
🍅 tomato
🥑 avocado
🥦 broccoli
🌽 corn
🥕 carrot
🥐 croissant
🍞 bread
🥖 baguette
🧀 cheese
🥚 egg
🍳 cooking
🥞 pancakes
🧇 waffle
🥓 bacon
🍔 hamburger
🍟 french fries
🍕 pizza
🌭 hot dog
🥪 sandwich
🌮 taco
🌯 burrito
🥗 green salad
🍝 spaghetti
🍜 steaming bowl
🍣 sushi
🍤 fried shrimp
🍦 soft ice cream
🍩 doughnut
🍪 cookie
🎂 birthday cake
🍰 shortcake
🧁 cupcake
🍫 chocolate bar
🍿 popcorn
🍬 candy
☕ hot beverage
🍵 teacup
🧋 bubble tea
🥤 cup with straw
🍺 beer mug
🍻 clinking beer
🥂 clinking glasses
🍷 wine glass
`,
  ),
  c(
    'travel',
    'Travel & places',
    `
🚗 automobile
🚕 taxi
🚙 sport utility vehicle
🚌 bus
🚎 trolleybus
🏎 racing car
🚓 police car
🚑 ambulance
🚒 fire engine
🚚 delivery truck
🚜 tractor
🛵 motor scooter
🏍 motorcycle
🚲 bicycle
🛴 kick scooter
🚨 police light
🚂 locomotive
🚆 train
🚇 metro
🚀 rocket
🛸 flying saucer
🚁 helicopter
✈️ airplane
🛩 small airplane
⛵ sailboat
🚤 speedboat
🛳 passenger ship
⚓ anchor
🏔 snow capped mountain
⛰ mountain
🌋 volcano
🏕 camping
🏖 beach with umbrella
🏝 desert island
🏜 desert
🗺 world map
🧭 compass
🏰 castle
🗼 tokyo tower
🗽 statue of liberty
⛲ fountain
🎡 ferris wheel
🎢 roller coaster
🌁 foggy
🌃 night with stars
🌆 cityscape at dusk
🌇 sunset
🌉 bridge at night
🏠 house
🏢 office building
🏫 school
🏥 hospital
🏦 bank
🏨 hotel
⛺ tent
`,
  ),
  c(
    'activities',
    'Activities',
    `
⚽ soccer ball
🏀 basketball
🏈 american football
⚾ baseball
🎾 tennis
🏐 volleyball
🏉 rugby football
🎱 pool 8 ball
🏓 ping pong
🏸 badminton
🥅 goal net
⛳ flag in hole
🏹 bow and arrow
🎣 fishing pole
🥊 boxing glove
🥋 martial arts uniform
⛸ ice skate
🎿 skis
🏂 snowboarder
🏋️ weight lifting
🤸 cartwheeling
🤺 fencing
🏇 horse racing
🧗 climbing
🚴 biking
🏆 trophy
🥇 first place
🥈 second place
🥉 third place
🎖 military medal
🎯 bullseye
🎲 game die
♟ chess pawn
🎮 video game
🕹 joystick
🎰 slot machine
🎳 bowling
🎨 artist palette
🎭 performing arts
🎤 microphone
🎧 headphone
🎼 musical score
🎹 musical keyboard
🥁 drum
🎷 saxophone
🎺 trumpet
🎸 guitar
🎻 violin
🎬 clapper board
🎪 circus tent
🎉 party popper
🎊 confetti ball
🎈 balloon
🎁 wrapped gift
`,
  ),
  c(
    'objects',
    'Objects',
    `
⌚ watch
📱 mobile phone
💻 laptop
⌨️ keyboard
🖥 desktop computer
🖨 printer
🖱 computer mouse
💽 computer disk
💾 floppy disk
💿 optical disk
📀 dvd
📷 camera
📸 camera with flash
📹 video camera
🎥 movie camera
📽 film projector
🔍 magnifying glass
🔬 microscope
🔭 telescope
📡 satellite antenna
💡 light bulb
🔦 flashlight
🕯 candle
📔 notebook
📖 open book
📚 books
📝 memo
✏️ pencil
🖊 pen
🖌 paintbrush
📌 pushpin
📎 paperclip
✂️ scissors
📐 triangular ruler
📏 straight ruler
🔒 locked
🔓 unlocked
🔏 locked with pen
🔑 key
🔨 hammer
🪛 screwdriver
🔧 wrench
⚙️ gear
🧲 magnet
⚗️ alembic
🧪 test tube
🧬 dna
💊 pill
🛒 shopping cart
💰 money bag
💳 credit card
💎 gem stone
⏳ hourglass
⏰ alarm clock
🧊 ice
🪩 mirror ball
`,
  ),
  c(
    'symbols',
    'Symbols',
    `
❤️ red heart
🧡 orange heart
💛 yellow heart
💚 green heart
💙 blue heart
💜 purple heart
🖤 black heart
🤍 white heart
💔 broken heart
❣️ heart exclamation
💕 two hearts
💞 revolving hearts
💓 beating heart
💗 growing heart
💖 sparkling heart
💘 heart with arrow
💝 heart with ribbon
💯 hundred points
💢 anger symbol
💥 collision
💫 dizzy
💦 sweat droplets
💨 dashing away
🕳 hole
💬 speech balloon
💭 thought balloon
✅ check mark button
❌ cross mark
❓ question mark
❗ exclamation mark
⭕ hollow red circle
🚫 prohibited
♻️ recycling symbol
🔔 bell
🔕 bell with slash
🔊 speaker high volume
📢 loudspeaker
🔴 red circle
🟠 orange circle
🟡 yellow circle
🟢 green circle
🔵 blue circle
🟣 purple circle
⚫ black circle
⚪ white circle
🟥 red square
🟧 orange square
🟨 yellow square
🟩 green square
🟦 blue square
⬛ black large square
⬜ white large square
`,
  ),
  c(
    'flags',
    'Flags',
    `
🏁 chequered flag
🚩 triangular flag
🎌 crossed flags
🏴 black flag
🏳️ white flag
🏳️‍🌈 rainbow flag
🇹🇷 turkey
🇺🇸 united states
🇬🇧 united kingdom
🇩🇪 germany
🇫🇷 france
🇪🇸 spain
🇮🇹 italy
🇯🇵 japan
🇰🇷 south korea
🇨🇳 china
🇧🇷 brazil
🇨🇦 canada
🇦🇺 australia
🇮🇳 india
🇳🇱 netherlands
🇸🇪 sweden
🇳🇴 norway
🇨🇭 switzerland
`,
  ),
];

export function searchEmojis(q: string): EmojiCategory[] {
  const s = q.trim().toLowerCase();
  if (!s) return EMOJI_CATEGORIES;
  return EMOJI_CATEGORIES.map((k) => ({
    ...k,
    items: k.items.filter((i) => i.n.includes(s) || i.e === s),
  })).filter((k) => k.items.length);
}

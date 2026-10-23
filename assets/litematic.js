/* ==========================================================================
   Litematica (.litematic) 3D preview
   Reads the schematic in the browser (gzip + NBT), turns it into coloured
   blocks and draws it with WebGL 2. No textures or external libraries.
   app.js calls  LitematicPreview.mount(element, fileUrl)  in the file dialog.
   ========================================================================== */
(() => {
  'use strict';

  const MAX_VOLUME = 32e6;      // blocks in the bounding box
  const MAX_SIDE = 2040;        // vertex positions are 16-bit (1/16 block units)
  const MAX_FACES = 6e6;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  class PreviewError extends Error {}

  /* ---------- File reading: gzip + NBT ---------- */

  async function gunzip(buffer) {
    const head = new Uint8Array(buffer, 0, 2);
    if (head[0] !== 0x1f || head[1] !== 0x8b) return buffer;   // already uncompressed
    if (typeof DecompressionStream === 'undefined') throw new PreviewError('This browser can’t unpack the file. Try a newer browser.');
    const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).arrayBuffer();
  }

  /** Minimal NBT reader. Long arrays come back as Uint32Array words, low word first. */
  function readNBT(buffer) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    const utf8 = new TextDecoder();
    let pos = 0;

    const string = () => {
      const len = view.getUint16(pos);
      pos += 2;
      const s = utf8.decode(bytes.subarray(pos, pos + len));
      pos += len;
      return s;
    };

    function payload(type) {
      let v, n;
      switch (type) {
        case 1: return view.getInt8(pos++);
        case 2: v = view.getInt16(pos); pos += 2; return v;
        case 3: v = view.getInt32(pos); pos += 4; return v;
        case 4: v = view.getInt32(pos) * 4294967296 + view.getUint32(pos + 4); pos += 8; return v;
        case 5: v = view.getFloat32(pos); pos += 4; return v;
        case 6: v = view.getFloat64(pos); pos += 8; return v;
        case 7: n = view.getInt32(pos); pos += 4; v = bytes.slice(pos, pos + n); pos += n; return v;
        case 8: return string();
        case 9: {
          const t = view.getUint8(pos++);
          n = view.getInt32(pos); pos += 4;
          const list = [];
          for (let i = 0; i < n; i++) list.push(payload(t));
          return list;
        }
        case 10: {
          const obj = {};
          for (;;) {
            const t = view.getUint8(pos++);
            if (t === 0) return obj;
            const name = string();
            obj[name] = payload(t);
          }
        }
        case 11:
          n = view.getInt32(pos); pos += 4;
          v = new Int32Array(n);
          for (let i = 0; i < n; i++, pos += 4) v[i] = view.getInt32(pos);
          return v;
        case 12:
          n = view.getInt32(pos); pos += 4;
          v = new Uint32Array(n * 2);
          for (let i = 0; i < n; i++, pos += 8) {
            v[2 * i + 1] = view.getUint32(pos);
            v[2 * i] = view.getUint32(pos + 4);
          }
          return v;
        default: throw new PreviewError(`Unknown NBT tag ${type}`);
      }
    }

    if (view.getUint8(pos++) !== 10) throw new PreviewError('This isn’t a Litematica schematic.');
    string();
    return payload(10);
  }

  /* ---------- Block appearance ---------- */

  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const AIR = new Set(['air', 'cave_air', 'void_air', 'structure_void', 'light', 'barrier', 'moving_piston']);

  const DYES = {
    white: '#e9ecec', orange: '#f07613', magenta: '#bd44b3', light_blue: '#3aafd9', yellow: '#f8c527', lime: '#70b919',
    pink: '#ed8dac', gray: '#3e4447', light_gray: '#8e8e86', cyan: '#158991', purple: '#792aac', blue: '#35399d',
    brown: '#724728', green: '#546d1b', red: '#a12722', black: '#141519',
  };
  const TERRACOTTA = {
    white: '#d1b2a1', orange: '#a15325', magenta: '#95576c', light_blue: '#706c8a', yellow: '#ba8523', lime: '#677535',
    pink: '#a14e4e', gray: '#392a23', light_gray: '#876b62', cyan: '#575b5b', purple: '#764656', blue: '#4a3b5b',
    brown: '#4d3323', green: '#4c532a', red: '#8f3d2e', black: '#251610',
  };
  const DYED = /^(white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black)_(wool|carpet|concrete|concrete_powder|terracotta|glazed_terracotta|stained_glass|stained_glass_pane|bed|banner|wall_banner|shulker_box|candle|candle_cake)$/;

  const WOOD = /(dark_oak|pale_oak|oak|spruce|birch|jungle|acacia|mangrove|cherry|bamboo|crimson|warped)/;
  const PLANKS = {
    oak: '#a2834f', spruce: '#735531', birch: '#c4b07b', jungle: '#a07351', acacia: '#a95b33', dark_oak: '#432b14',
    mangrove: '#763631', cherry: '#e3b3ad', pale_oak: '#e4dad8', bamboo: '#c4ad55', crimson: '#65314a', warped: '#2b6863',
  };
  const BARK = {
    oak: '#6d5533', spruce: '#3b2711', birch: '#d8d7d2', jungle: '#58461a', acacia: '#6a6259', dark_oak: '#3c2e1a',
    mangrove: '#54432b', cherry: '#36202b', pale_oak: '#4f4744', bamboo: '#7a8c2f', crimson: '#5c1a1e', warped: '#3a3b4e',
  };
  const LEAVES = {
    oak: '#4a7c2a', spruce: '#3d5e3d', birch: '#6a8f3c', jungle: '#3f8a1f', acacia: '#5b7d22', dark_oak: '#3f6b1f',
    mangrove: '#5a8a26', cherry: '#e9b0c8', pale_oak: '#a3a89c',
  };

  // [pattern, side, top?, bottom?]; first match wins. Checked before the wood rule.
  const RULES_EARLY = [
    [/^(water|bubble_column)$/, '#3f6fd8'],
    [/^lava$/, '#e0661a'],
    [/^grass_block$/, '#86603f', '#6aa33a', '#86603f'],
    [/^podzol$/, '#7a5a32', '#5b3e1e', '#86603f'],
    [/^mycelium$/, '#86603f', '#6f6265', '#86603f'],
    [/^dirt_path$/, '#94793d', '#a08a4a', '#86603f'],
    [/^farmland$/, '#86603f', '#4e3420', '#86603f'],
    [/crimson_nylium/, '#6f3534', '#8b1e1e', '#6f3534'],
    [/warped_nylium/, '#6f3534', '#2b7265', '#6f3534'],
    [/nether_wart_block/, '#731907'],
    [/warped_wart_block/, '#167e86'],
    [/mangrove_roots/, '#4a3b2a'],
    [/^bamboo$|bamboo_sapling/, '#5d8a2a'],
    [/dead_bush/, '#8a6a3a'],
    [/wither_rose/, '#2a2a1d'],
    [/poppy|rose|red_tulip|red_mushroom$/, '#c8302a'],
    [/dandelion|sunflower/, '#f2d023'],
    [/cornflower|blue_orchid/, '#4766d6'],
    [/allium|lilac/, '#b46fd8'],
    [/oxeye|azure|white_tulip|lily_of_the_valley/, '#e8ebe0'],
    [/pink_tulip|peony|pink_petals/, '#eb9fc0'],
    [/orange_tulip|torchflower/, '#e8862b'],
    [/brown_mushroom$/, '#9a7558'],
    [/crimson_(roots|fungus)/, '#8e1f2a'],
    [/warped_(roots|fungus)|nether_sprouts/, '#14a08e'],
    [/^cactus$/, '#5a8a32'],
    [/^moss/, '#596e2d'],
    [/sapling|grass$|fern$|bush$|^vine$|kelp|seagrass|lily_pad|sugar_cane|azalea|dripleaf|hanging_roots|wheat|carrots|potatoes|beetroots|_stem$|glow_lichen|cave_vines|weeping|twisting|propagule|leaf_litter/, '#5c8f32'],
  ];
  const RULES = [
    [/^mud$/, '#3c393c'],
    [/mud_brick|packed_mud/, '#89674f'],
    [/dirt/, '#86603f'],
    [/clay$/, '#a0a6b3'],
    [/red_sandstone/, '#b5621f'],
    [/red_sand$/, '#be6621'],
    [/sandstone/, '#d8cb9b'],
    [/sand$/, '#dbcfa3'],
    [/gravel/, '#847f7f'],
    [/snow/, '#f3f7f7'],
    [/blue_ice/, '#74a8fd'],
    [/packed_ice/, '#8db4fa'],
    [/ice$/, '#91b7fd'],
    [/^melon$/, '#6f9123', '#7c9a26'],
    [/carved_pumpkin|jack_o_lantern|^pumpkin$/, '#c37719'],
    [/hay_block/, '#a68b0c', '#b49415'],
    [/red_mushroom_block/, '#c42f2f'],
    [/brown_mushroom_block/, '#956f52'],
    [/mushroom_stem/, '#cbc4b9'],
    [/ancient_debris/, '#5f4840'],
    [/deepslate_.*ore$/, '#55555c'],
    [/nether_.*ore$/, '#6f3534'],
    [/_ore$/, '#7f7f7f'],
    [/repeater|comparator|daylight/, '#a8a29e'],
    [/redstone_block/, '#a11a0a'],
    [/redstone_lamp/, '#5f3a22'],
    [/redstone/, '#a33a2a'],
    [/glowstone/, '#d0a05c'],
    [/sea_lantern/, '#bcd4cc'],
    [/shroomlight/, '#f09a46'],
    [/froglight/, '#e9dfa8'],
    [/end_stone/, '#dbde9e'],
    [/blackstone/, '#2a2329'],
    [/basalt/, '#4f4f55'],
    [/dripstone/, '#866b5c'],
    [/calcite/, '#dfe0dc'],
    [/tuff/, '#6c6d66'],
    [/deepslate/, '#50505a'],
    [/smooth_stone/, '#9e9e9e'],
    [/mossy/, '#6e7a5a'],
    [/cobble/, '#7a7a7a'],
    [/granite/, '#9a6a56'],
    [/diorite/, '#bcbcbc'],
    [/andesite/, '#888888'],
    [/red_nether_brick/, '#450709'],
    [/nether_brick/, '#2c1519'],
    [/netherrack/, '#6f3534'],
    [/soul_(sand|soil)/, '#4f3d31'],
    [/soul_(torch|lantern|fire|campfire)/, '#7dd5e0'],
    [/quartz/, '#ece6df'],
    [/dark_prismarine/, '#335b4b'],
    [/prismarine_brick/, '#63ab9e'],
    [/prismarine/, '#63a397'],
    [/purpur/, '#a97ca9'],
    [/crying_obsidian/, '#2b1047'],
    [/obsidian/, '#15111f'],
    [/stone_brick/, '#7a7a7a'],
    [/brick/, '#966253'],
    [/oxidized/, '#52a385'],
    [/weathered/, '#6c9d73'],
    [/exposed/, '#a27e68'],
    [/raw_copper/, '#9a6a4f'],
    [/copper/, '#c06c50'],
    [/anvil/, '#4a4a4a'],
    [/hopper|cauldron/, '#4a4a4f'],
    [/raw_iron/, '#a6876b'],
    [/iron|^chain$/, '#d0d0d0'],
    [/raw_gold/, '#dda12a'],
    [/gold_block|weighted|^bell$/, '#f6d03e'],
    [/diamond_block/, '#62ede4'],
    [/emerald_block/, '#2acb57'],
    [/lapis_block/, '#1f43a0'],
    [/coal_block/, '#141414'],
    [/netherite_block/, '#433e40'],
    [/amethyst/, '#8561bf'],
    [/sculk/, '#0d1e24'],
    [/slime/, '#6fc05a'],
    [/honeycomb_block/, '#e5941e'],
    [/honey/, '#f0a925'],
    [/bookshelf/, '#6b5133', '#a2834f'],
    [/crafting_table/, '#7a5a35', '#a8784a'],
    [/ender_chest/, '#253535'],
    [/furnace|smoker|dispenser|dropper|observer|piston/, '#6e6e6e'],
    [/tnt/, '#c1362d'],
    [/beacon/, '#7fe6e0'],
    [/spawner/, '#1f2b36'],
    [/sponge/, '#c4c04a'],
    [/target/, '#e2aca3'],
    [/bedrock/, '#555555'],
    [/torch|lantern|end_rod|candle|campfire|^fire$/, '#f5c542'],
    [/tinted_glass/, '#2f2a36'],
    [/glass/, '#cfe7f2'],
    [/chest|barrel|composter|lectern|loom|table|beehive|bee_nest|note_block|jukebox|scaffolding|ladder|lever/, '#9a7140'],
    [/stone/, '#7f7f7f'],
    [/head|skull/, '#c9b49a'],
    [/rail/, '#8a7a62'],
    [/cake/, '#f2e8d5'],
    [/cobweb|tripwire|string/, '#e8e8e8'],
    [/flower_pot|potted/, '#7a4535'],
  ];

  function fallbackColor(name) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
    const hue = ((h >>> 0) % 360) / 60;
    const c = 0.22;
    const x = c * (1 - Math.abs((hue % 2) - 1));
    const [r, g, b] = hue < 1 ? [c, x, 0] : hue < 2 ? [x, c, 0] : hue < 3 ? [0, c, x] : hue < 4 ? [0, x, c] : hue < 5 ? [x, 0, c] : [c, 0, x];
    const m = 0.45;
    return [r, g, b].map(v => Math.round((v + m) * 255));
  }

  function colorOf(name) {
    const look = (side, top = side, bottom = top) => ({ side: hex(side), top: hex(top), bottom: hex(bottom) });
    const dyed = DYED.exec(name);
    if (dyed) return look((/terracotta$/.test(dyed[2]) && dyed[2] !== 'glazed_terracotta' ? TERRACOTTA : DYES)[dyed[1]]);
    if (name === 'terracotta') return look('#985e43');
    if (/leaves$/.test(name)) {
      const wood = WOOD.exec(name);
      return look(/flowering/.test(name) ? '#6e7d3a' : /azalea/.test(name) ? '#5a7a2c' : LEAVES[wood && wood[1]] || '#4a7c2a');
    }
    for (const [re, ...colors] of RULES_EARLY) if (re.test(name)) return look(...colors);
    const wood = WOOD.exec(name);
    if (wood) {
      const kind = wood[1];
      if (/(_log|_wood|_stem|_hyphae|bamboo_block)$/.test(name) && !/stripped/.test(name)) {
        return /_log|_stem|bamboo_block/.test(name) ? look(BARK[kind], PLANKS[kind]) : look(BARK[kind]);
      }
      return look(PLANKS[kind]);
    }
    for (const [re, ...colors] of RULES) if (re.test(name)) return look(...colors);
    const c = fallbackColor(name);
    return { side: c, top: c, bottom: c };
  }

  /* ---------- Block shapes (boxes in 1/16 block units; null = full cube) ---------- */

  const box = (x0, y0, z0, x1, y1, z1) => [x0, y0, z0, x1, y1, z1];
  const CROSS = h => [box(2, 0, 7, 14, h, 9), box(7, 0, 2, 9, h, 14)];
  const PLANT = /sapling|tulip|orchid|allium|bluet|daisy|poppy|dandelion|cornflower|lily_of_the_valley|wither_rose|^short_grass$|^grass$|^tall_grass$|fern$|dead_bush|_mushroom$|fungus$|_roots$|sprouts$|seagrass|^kelp|sugar_cane|^wheat$|carrots$|potatoes$|beetroots$|berry_bush|sunflower|lilac|rose_bush|peony|pitcher|torchflower$|torchflower_crop|nether_wart$|cobweb|coral$|coral_fan$|coral_wall_fan$|^(melon|pumpkin)_stem$|attached_|cave_vines|weeping_vines|twisting_vines|propagule|small_dripleaf|amethyst_bud$|amethyst_cluster$|pointed_dripstone|bush$|dry_grass|cactus_flower|^fire$|soul_fire/;

  /** Rotates a box drawn for facing=north (stuck to the south side) to another facing. */
  function facingBox(facing, [x0, y0, z0, x1, y1, z1]) {
    switch (facing) {
      case 'south': return [16 - x1, y0, 16 - z1, 16 - x0, y1, 16 - z0];
      case 'east': return [16 - z1, y0, x0, 16 - z0, y1, x1];
      case 'west': return [z0, y0, 16 - x1, z1, y1, 16 - x0];
      default: return [x0, y0, z0, x1, y1, z1];
    }
  }

  /** A centred post plus an arm toward every connected side (fences, walls, panes, bars). */
  function connected(p, half, armHalf, y0, y1, armY0, armY1) {
    const boxes = [box(8 - half, y0, 8 - half, 8 + half, y1, 8 + half)];
    const on = side => p[side] && p[side] !== 'false' && p[side] !== 'none';
    const a0 = 8 - armHalf, a1 = 8 + armHalf;
    if (on('north')) boxes.push(box(a0, armY0, 0, a1, armY1, 8));
    if (on('south')) boxes.push(box(a0, armY0, 8, a1, armY1, 16));
    if (on('west')) boxes.push(box(0, armY0, a0, 8, armY1, a1));
    if (on('east')) boxes.push(box(8, armY0, a0, 16, armY1, a1));
    return boxes;
  }

  function pole(axis, r) {
    const a = 8 - r, b = 8 + r;
    return axis === 'x' ? [box(0, a, a, 16, b, b)] : axis === 'z' ? [box(a, a, 0, b, b, 16)] : [box(a, 0, a, b, 16, b)];
  }

  function shapeOf(name, p) {
    if (/_slab$/.test(name)) return p.type === 'double' ? null : p.type === 'top' ? [box(0, 8, 0, 16, 16, 16)] : [box(0, 0, 0, 16, 8, 16)];
    if (/_stairs$/.test(name)) {
      const top = p.half === 'top';
      const [y0, y1] = top ? [0, 8] : [8, 16];
      // The tall half sits on the side the stairs face
      return [top ? box(0, 8, 0, 16, 16, 16) : box(0, 0, 0, 16, 8, 16), facingBox(p.facing, box(0, y0, 0, 16, y1, 8))];
    }
    if (/_carpet$/.test(name)) return [box(0, 0, 0, 16, 1, 16)];
    if (name === 'snow') return Number(p.layers) >= 8 ? null : [box(0, 0, 0, 16, 2 * (Number(p.layers) || 1), 16)];
    if (/pressure_plate$/.test(name)) return [box(1, 0, 1, 15, 1, 15)];
    if (/rail$/.test(name)) return [box(0, 0, 0, 16, 2, 16)];
    if (name === 'redstone_wire' || name === 'tripwire') return [box(0, 0, 0, 16, 1, 16)];
    if (name === 'lily_pad') return [box(1, 0, 1, 15, 1, 15)];
    if (/repeater|comparator/.test(name)) return [box(0, 0, 0, 16, 2, 16)];
    if (/daylight_detector/.test(name)) return [box(0, 0, 0, 16, 6, 16)];
    if (name === 'farmland' || name === 'dirt_path') return [box(0, 0, 0, 16, 15, 16)];
    if (/_trapdoor$/.test(name)) {
      if (p.open === 'true') return [facingBox(p.facing, box(0, 0, 13, 16, 16, 16))];
      return p.half === 'top' ? [box(0, 13, 0, 16, 16, 16)] : [box(0, 0, 0, 16, 3, 16)];
    }
    if (/_door$/.test(name)) return [facingBox(p.facing, box(0, 0, 13, 16, 16, 16))];
    if (/_fence_gate$/.test(name)) return p.facing === 'east' || p.facing === 'west' ? [box(7, 5, 0, 9, 16, 16)] : [box(0, 5, 7, 16, 16, 9)];
    if (/_fence$/.test(name)) return connected(p, 2, 1, 0, 16, 6, 15);
    if (/_wall$/.test(name)) return connected(p, 4, 3, 0, 16, 0, 14);
    if (/pane$|^iron_bars$/.test(name)) return connected(p, 1, 1, 0, 16, 0, 16);
    if (/wall_torch$/.test(name)) return [facingBox(p.facing, box(7, 3, 11, 9, 13, 16))];
    if (/torch$/.test(name)) return [box(7, 0, 7, 9, 10, 9)];
    if (name === 'ladder') return [facingBox(p.facing, box(0, 0, 14, 16, 16, 16))];
    if (/wall_hanging_sign$/.test(name)) return [facingBox(p.facing, box(1, 0, 7, 15, 10, 9))];
    if (/hanging_sign$/.test(name)) return [box(1, 0, 7, 15, 10, 9)];
    if (/wall_sign$/.test(name)) return [facingBox(p.facing, box(0, 4, 14, 16, 12, 16))];
    if (/_sign$/.test(name)) return [box(7, 0, 7, 9, 9, 9), box(0, 9, 7, 16, 16, 9)];
    if (/wall_banner$/.test(name)) return [facingBox(p.facing, box(1, 0, 14, 15, 16, 16))];
    if (/_banner$/.test(name)) return [box(7, 0, 7, 9, 16, 9), box(1, 4, 7, 15, 16, 8)];
    if (/_button$/.test(name) || name === 'lever') {
      if (p.face === 'floor') return [box(5, 0, 6, 11, 2, 10)];
      if (p.face === 'ceiling') return [box(5, 14, 6, 11, 16, 10)];
      return [facingBox(p.facing, box(5, 6, 14, 11, 10, 16))];
    }
    if (/lantern$/.test(name) && name !== 'sea_lantern' && name !== 'jack_o_lantern') {
      return p.hanging === 'true' ? [box(5, 7, 5, 11, 16, 11)] : [box(5, 0, 5, 11, 9, 11)];
    }
    if (name === 'chain' || /_chain$/.test(name)) return pole(p.axis || 'y', 2);
    if (/end_rod|lightning_rod/.test(name)) return pole(p.facing === 'east' || p.facing === 'west' ? 'x' : p.facing === 'north' || p.facing === 'south' ? 'z' : 'y', 2);
    if (name === 'bamboo') return pole('y', 2);
    if (/^(vine|glow_lichen|sculk_vein|resin_clump)$/.test(name)) {
      const plates = { north: box(0, 0, 0, 16, 16, 1), south: box(0, 0, 15, 16, 16, 16), west: box(0, 0, 0, 1, 16, 16),
        east: box(15, 0, 0, 16, 16, 16), up: box(0, 15, 0, 16, 16, 16), down: box(0, 0, 0, 16, 1, 16) };
      const boxes = Object.keys(plates).filter(side => p[side] === 'true').map(side => plates[side]);
      return boxes.length ? boxes : [plates.down];
    }
    if (/chest$/.test(name)) return [box(1, 0, 1, 15, 14, 15)];
    if (/_bed$/.test(name)) return [box(0, 0, 0, 16, 9, 16)];
    if (/cake$/.test(name)) return [box(1, 0, 1, 15, 8, 15)];
    if (/candle$/.test(name)) return [box(7, 0, 7, 9, 6, 9)];
    if (name === 'enchanting_table') return [box(0, 0, 0, 16, 12, 16)];
    if (name === 'stonecutter') return [box(0, 0, 0, 16, 9, 16)];
    if (/campfire$/.test(name)) return [box(0, 0, 0, 16, 7, 16)];
    if (/anvil$/.test(name)) return [box(2, 0, 2, 14, 4, 14), box(4, 4, 3, 12, 10, 13), box(0, 10, 3, 16, 16, 13)];
    if (name === 'brewing_stand') return [box(7, 0, 7, 9, 14, 9), box(1, 0, 1, 15, 2, 15)];
    if (/wall_(head|skull)$/.test(name)) return [facingBox(p.facing, box(4, 4, 8, 12, 12, 16))];
    if (/(head|skull)$/.test(name)) return [box(4, 0, 4, 12, 8, 12)];
    if (name === 'flower_pot') return [box(5, 0, 5, 11, 6, 11)];
    if (/^potted_/.test(name)) return [box(5, 0, 5, 11, 6, 11), box(7, 6, 7, 9, 13, 9)];
    if (/turtle_egg|sea_pickle/.test(name)) return [box(5, 0, 5, 11, 6, 11)];
    if (name === 'conduit') return [box(5, 5, 5, 11, 11, 11)];
    if (/mangrove_roots/.test(name)) return null;
    if (PLANT.test(name)) return CROSS(/^(tall_grass|large_fern|sunflower|lilac|rose_bush|peony|sugar_cane|kelp|kelp_plant|tall_seagrass)$/.test(name) ? 16 : 13);
    return null;
  }

  const TRANSLUCENT = /glass|^ice$|^frosted_ice$|^water$|^bubble_column$|slime_block|honey_block/;
  const KIND_CUBE = 1, KIND_CLEAR = 2, KIND_SHAPE = 3;

  function blockLook(name, props) {
    const colors = colorOf(name);
    const boxes = shapeOf(name, props);
    const clear = TRANSLUCENT.test(name);
    const alpha = !clear ? 255 : name === 'water' || name === 'bubble_column' ? 150 : name === 'tinted_glass' ? 210 : /slime|honey/.test(name) ? 190 : 105;
    return { ...colors, alpha, boxes, kind: boxes ? KIND_SHAPE : clear ? KIND_CLEAR : KIND_CUBE };
  }

  /* ---------- Litematic -> voxel grid ---------- */

  function parseLitematic(root) {
    const regions = Object.values(root.Regions || {});
    if (!regions.length) throw new PreviewError('This schematic has no regions.');

    const parts = regions.map(r => {
      const pos = r.Position || { x: 0, y: 0, z: 0 };
      const size = r.Size || { x: 0, y: 0, z: 0 };
      const min = axis => pos[axis] + (size[axis] < 0 ? size[axis] + 1 : 0);
      return { r, x: min('x'), y: min('y'), z: min('z'), sx: Math.abs(size.x), sy: Math.abs(size.y), sz: Math.abs(size.z) };
    }).filter(p => p.sx && p.sy && p.sz);
    if (!parts.length) throw new PreviewError('This schematic is empty.');

    const lo = axis => Math.min(...parts.map(p => p[axis]));
    const hi = (axis, s) => Math.max(...parts.map(p => p[axis] + p[s]));
    const ox = lo('x'), oy = lo('y'), oz = lo('z');
    const W = hi('x', 'sx') - ox, H = hi('y', 'sy') - oy, L = hi('z', 'sz') - oz;
    if (W > MAX_SIDE || H > MAX_SIDE || L > MAX_SIDE || W * H * L > MAX_VOLUME) {
      throw new PreviewError(`This build is too big to preview here (${W} × ${H} × ${L}).`);
    }

    const looks = [null];
    const names = ['air'];
    const idByKey = new Map();
    const globalId = entry => {
      const name = String(entry.Name || 'air').replace(/^minecraft:/, '');
      if (AIR.has(name)) return 0;
      const props = entry.Properties || {};
      const key = /^(water|lava)$/.test(name) ? name
        : `${name}[${Object.keys(props).sort().map(k => `${k}=${props[k]}`).join(',')}]`;
      let id = idByKey.get(key);
      if (id === undefined) {
        id = looks.length;
        if (id > 65535) throw new PreviewError('This schematic has too many different blocks to preview.');
        idByKey.set(key, id);
        looks.push(blockLook(name, props));
        names.push(name);
      }
      return id;
    };

    const grid = new Uint16Array(W * H * L);
    const counts = [];
    for (const part of parts) {
      const palette = part.r.BlockStatePalette || [];
      const words = part.r.BlockStates;
      if (!palette.length || !words) continue;
      const map = palette.map(globalId);
      const bits = Math.max(2, Math.ceil(Math.log2(palette.length)));
      const mask = bits >= 32 ? 0xffffffff : (1 << bits) - 1;
      const bx = part.x - ox, by = part.y - oy, bz = part.z - oz;
      let bit = 0;
      for (let y = 0; y < part.sy; y++) {
        for (let z = 0; z < part.sz; z++) {
          let i = ((y + by) * L + (z + bz)) * W + bx;
          for (let x = 0; x < part.sx; x++, i++, bit += bits) {
            const w = bit >>> 5, o = bit & 31;
            let v = words[w] >>> o;
            if (o + bits > 32) v |= words[w + 1] << (32 - o);
            const id = map[v & mask];
            if (id) { grid[i] = id; counts[id] = (counts[id] || 0) + 1; }
          }
        }
      }
    }

    // Material list grouped by block name
    const totals = new Map();
    counts.forEach((n, id) => { if (n) totals.set(names[id], (totals.get(names[id]) || 0) + n); });
    const materials = [...totals].sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count, color: colorOf(name).side }));

    const meta = root.Metadata || {};
    return {
      W, H, L, grid, looks, materials,
      blocks: materials.reduce((sum, m) => sum + m.count, 0),
      name: meta.Name || '',
      author: meta.Author || '',
    };
  }

  /* ---------- Mesh building ---------- */

  // +x, -x, +y, -y, +z, -z with a fixed light level per side
  const DIRS = [[1, 0, 0, .74], [-1, 0, 0, .74], [0, 1, 0, 1], [0, -1, 0, .55], [0, 0, 1, .87], [0, 0, -1, .87]];
  const FULL = box(0, 0, 0, 16, 16, 16);
  const STRIDE = 12;   // bytes per vertex: int16 x,y,z,pad + uint8 r,g,b,a

  function faceCorners(d, [x0, y0, z0, x1, y1, z1]) {
    switch (d) {
      case 0: return [x1, y0, z0, x1, y1, z0, x1, y1, z1, x1, y0, z1];
      case 1: return [x0, y0, z0, x0, y1, z0, x0, y1, z1, x0, y0, z1];
      case 2: return [x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1];
      case 3: return [x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1];
      case 4: return [x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1];
      default: return [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0];
    }
  }

  /** Builds an opaque and a see-through mesh, showing only layers below yMax. */
  function buildMesh(model, yMax) {
    const { W, L, grid, looks } = model;
    const opaque = new Uint8Array(looks.length);
    looks.forEach((look, id) => { if (look && look.kind === KIND_CUBE) opaque[id] = 1; });

    const at = (x, y, z) => (x < 0 || z < 0 || y < 0 || x >= W || z >= L || y >= yMax ? 0 : grid[(y * L + z) * W + x]);
    const onEdge = (d, b) => (d === 0 ? b[3] === 16 : d === 1 ? b[0] === 0 : d === 2 ? b[4] === 16 : d === 3 ? b[1] === 0 : d === 4 ? b[5] === 16 : b[2] === 0);

    function walk(face) {
      for (let y = 0; y < yMax; y++) {
        for (let z = 0; z < L; z++) {
          for (let x = 0; x < W; x++) {
            const id = grid[(y * L + z) * W + x];
            if (!id) continue;
            const look = looks[id];
            const target = look.alpha < 255 ? 1 : 0;
            for (let d = 0; d < 6; d++) {
              const n = at(x + DIRS[d][0], y + DIRS[d][1], z + DIRS[d][2]);
              if (look.kind === KIND_SHAPE) {
                for (const b of look.boxes) if (!(opaque[n] && onEdge(d, b))) face(target, x, y, z, b, d, look);
              } else if (!opaque[n] && !(look.kind === KIND_CLEAR && n === id)) {
                face(target, x, y, z, FULL, d, look);
              }
            }
          }
        }
      }
    }

    const counts = [0, 0];
    walk(target => { counts[target]++; });
    if (counts[0] + counts[1] > MAX_FACES) throw new PreviewError('This build is too detailed to preview here.');

    const out = counts.map(n => {
      const buffer = new ArrayBuffer(n * 4 * STRIDE);
      return { n: 0, i16: new Int16Array(buffer), u8: new Uint8Array(buffer), indices: n * 6 };
    });
    walk((target, x, y, z, b, d, look) => {
      const m = out[target];
      const c = faceCorners(d, b);
      const color = d === 2 ? look.top : d === 3 ? look.bottom : look.side;
      const h = Math.imul(x * 73856093 ^ y * 19349663 ^ z * 83492791, 2654435761) >>> 24;
      const light = DIRS[d][3] * (0.93 + h / 255 * 0.12);
      for (let k = 0; k < 4; k++) {
        const v = m.n * 4 + k;
        m.i16[v * 6] = x * 16 + c[k * 3];
        m.i16[v * 6 + 1] = y * 16 + c[k * 3 + 1];
        m.i16[v * 6 + 2] = z * 16 + c[k * 3 + 2];
        m.u8[v * 12 + 8] = Math.min(255, color[0] * light);
        m.u8[v * 12 + 9] = Math.min(255, color[1] * light);
        m.u8[v * 12 + 10] = Math.min(255, color[2] * light);
        m.u8[v * 12 + 11] = look.alpha;
      }
      m.n++;
    });
    return out.map(m => ({ vertices: m.u8, quads: m.n }));
  }

  /* ---------- WebGL viewer ---------- */

  const VERT = `#version 300 es
    in vec3 aPos;
    in vec4 aColor;
    uniform mat4 uMvp;
    uniform vec3 uCenter;
    out vec3 vPos;
    out vec4 vColor;
    void main() {
      vPos = aPos / 16.0;
      vColor = aColor;
      gl_Position = uMvp * vec4(vPos - uCenter, 1.0);
    }`;

  // Darkens block edges so individual blocks stay readable without textures
  const FRAG = `#version 300 es
    precision highp float;
    in vec3 vPos;
    in vec4 vColor;
    out vec4 outColor;
    void main() {
      vec3 n = abs(cross(dFdx(vPos), dFdy(vPos)));
      vec3 w = max(fwidth(vPos), vec3(1e-4));
      vec3 g = abs(fract(vPos - 0.5) - 0.5) / w;
      float line; float px;
      if (n.x > n.y && n.x > n.z) { line = min(g.y, g.z); px = max(w.y, w.z); }
      else if (n.y > n.z) { line = min(g.x, g.z); px = max(w.x, w.z); }
      else { line = min(g.x, g.y); px = max(w.x, w.y); }
      float edge = (1.0 - min(line, 1.0)) * 0.3 * (1.0 - smoothstep(0.08, 0.3, px));
      outColor = vec4(vColor.rgb * (1.0 - edge) * vColor.a, vColor.a);
    }`;

  const mat4 = {
    perspective(fovy, aspect, near, far) {
      const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
      return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
    },
    multiply(a, b) {
      const out = new Float32Array(16);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
      return out;
    },
  };
  const norm = v => { const l = Math.hypot(...v) || 1; return v.map(c => c / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  function compile(gl, vert, frag) {
    const prog = gl.createProgram();
    [[gl.VERTEX_SHADER, vert], [gl.FRAGMENT_SHADER, frag]].forEach(([type, src]) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      gl.attachShader(prog, shader);
    });
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    return prog;
  }

  function createViewer(canvas, model) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true });
    if (!gl) throw new PreviewError('Your browser can’t show 3D previews (WebGL 2 is unavailable).');

    const prog = compile(gl, VERT, FRAG);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    const aColor = gl.getAttribLocation(prog, 'aColor');
    const uMvp = gl.getUniformLocation(prog, 'uMvp');
    const uCenter = gl.getUniformLocation(prog, 'uCenter');

    const meshes = [0, 1].map(() => {
      const vao = gl.createVertexArray();
      const vbo = gl.createBuffer();
      const ibo = gl.createBuffer();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 3, gl.SHORT, false, STRIDE, 0);
      gl.enableVertexAttribArray(aColor);
      gl.vertexAttribPointer(aColor, 4, gl.UNSIGNED_BYTE, true, STRIDE, 8);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bindVertexArray(null);
      return { vao, vbo, ibo, count: 0 };
    });

    let indexCapacity = 0;
    let indexData = new Uint32Array(0);
    function quadIndices(quads) {
      if (quads > indexCapacity) {
        indexCapacity = quads;
        indexData = new Uint32Array(quads * 6);
        for (let q = 0, v = 0; q < quads; q++, v += 4) indexData.set([v, v + 1, v + 2, v, v + 2, v + 3], q * 6);
      }
      return indexData.subarray(0, quads * 6);
    }

    function setMesh(data) {
      data.forEach((d, i) => {
        const m = meshes[i];
        gl.bindVertexArray(m.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, m.vbo);
        gl.bufferData(gl.ARRAY_BUFFER, d.vertices, gl.STATIC_DRAW);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, quadIndices(d.quads), gl.STATIC_DRAW);
        m.count = d.quads * 6;
      });
      gl.bindVertexArray(null);
      invalidate();
    }

    /* Camera: orbits a target point */
    const { W, H, L } = model;
    const radius = Math.max(2, Math.hypot(W, H, L) / 2);
    const fov = 40 * Math.PI / 180;
    const home = () => ({ theta: -0.65, phi: 0.52, dist: radius / Math.sin(fov / 2) * 1.02, target: [0, 0, 0] });
    let cam = home();
    let basis = { right: [1, 0, 0], up: [0, 1, 0] };
    let spinning = !reducedMotion.matches;

    function matrix() {
      const { theta, phi, dist, target } = cam;
      const eye = [
        target[0] + dist * Math.cos(phi) * Math.sin(theta),
        target[1] + dist * Math.sin(phi),
        target[2] + dist * Math.cos(phi) * Math.cos(theta),
      ];
      const z = norm([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
      const x = norm(cross([0, 1, 0], z));
      const y = cross(z, x);
      basis = { right: x, up: y };
      const view = [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
      const near = Math.max(0.05, dist - radius * 1.6);
      const proj = mat4.perspective(fov, canvas.width / canvas.height || 1, Math.min(near, dist * 0.5), dist + radius * 2.5);
      return mat4.multiply(proj, view);
    }

    function resize() {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
      if (w && h && (canvas.width !== w || canvas.height !== h)) { canvas.width = w; canvas.height = h; }
    }

    function draw() {
      resize();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(prog);
      gl.uniformMatrix4fv(uMvp, false, matrix());
      gl.uniform3f(uCenter, W / 2, H / 2, L / 2);
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);

      gl.disable(gl.BLEND);
      gl.depthMask(true);
      gl.bindVertexArray(meshes[0].vao);
      if (meshes[0].count) gl.drawElements(gl.TRIANGLES, meshes[0].count, gl.UNSIGNED_INT, 0);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.bindVertexArray(meshes[1].vao);
      if (meshes[1].count) gl.drawElements(gl.TRIANGLES, meshes[1].count, gl.UNSIGNED_INT, 0);
      gl.depthMask(true);
      gl.bindVertexArray(null);
    }

    let frame = 0, last = 0, dirty = true;
    function tick(now) {
      frame = 0;
      if (spinning && last) cam.theta += Math.min(now - last, 50) * 0.00025;
      last = now;
      draw();
      dirty = false;
      if (spinning) frame = requestAnimationFrame(tick);
    }
    function invalidate() {
      dirty = true;
      if (!frame) frame = requestAnimationFrame(tick);
    }
    const stopSpin = () => { spinning = false; last = 0; };

    /* Input: drag to orbit, right/shift-drag to pan, wheel or pinch to zoom */
    const pointers = new Map();
    let panning = false;
    const clampPhi = phi => Math.max(-1.45, Math.min(1.45, phi));
    const zoom = factor => { cam.dist = Math.max(radius * 0.08, Math.min(radius * 14, cam.dist * factor)); };
    function pan(dx, dy) {
      const scale = 2 * cam.dist * Math.tan(fov / 2) / (canvas.clientHeight || 1);
      cam.target = cam.target.map((t, i) => t - basis.right[i] * dx * scale + basis.up[i] * dy * scale);
    }
    const spread = () => {
      const [a, b] = [...pointers.values()];
      return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };

    const handlers = {
      pointerdown(e) {
        canvas.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        panning = e.button === 2 || e.shiftKey || e.ctrlKey || e.metaKey;
        stopSpin();
      },
      pointermove(e) {
        const prev = pointers.get(e.pointerId);
        if (!prev) return;
        if (pointers.size === 2) {
          const before = spread();
          pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const after = spread();
          if (after.d > 0) zoom(before.d / after.d);
          pan(after.x - before.x, after.y - before.y);
        } else {
          const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
          pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (panning) pan(dx, dy);
          else { cam.theta -= dx * 0.008; cam.phi = clampPhi(cam.phi + dy * 0.008); }
        }
        invalidate();
      },
      pointerup(e) { pointers.delete(e.pointerId); },
      pointercancel(e) { pointers.delete(e.pointerId); },
      wheel(e) {
        e.preventDefault();
        stopSpin();
        zoom(Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
        invalidate();
      },
      dblclick() { reset(); },
      contextmenu(e) { e.preventDefault(); },
      keydown(e) {
        const step = { ArrowLeft: [0.15, 0], ArrowRight: [-0.15, 0], ArrowUp: [0, 0.12], ArrowDown: [0, -0.12] }[e.key];
        if (step) { cam.theta += step[0]; cam.phi = clampPhi(cam.phi + step[1]); }
        else if (e.key === '+' || e.key === '=') zoom(0.85);
        else if (e.key === '-' || e.key === '_') zoom(1.18);
        else return;
        e.preventDefault();
        stopSpin();
        invalidate();
      },
    };
    Object.entries(handlers).forEach(([type, fn]) => canvas.addEventListener(type, fn, { passive: type !== 'wheel' && type !== 'contextmenu' && type !== 'keydown' }));

    const observer = new ResizeObserver(invalidate);
    observer.observe(canvas);

    function reset() {
      stopSpin();
      cam = home();
      invalidate();
    }

    function destroy() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      Object.entries(handlers).forEach(([type, fn]) => canvas.removeEventListener(type, fn));
      meshes.forEach(m => { gl.deleteBuffer(m.vbo); gl.deleteBuffer(m.ibo); gl.deleteVertexArray(m.vao); });
      gl.deleteProgram(prog);
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }

    return { setMesh, reset, destroy };
  }

  /* ---------- Loading (cached per URL) ---------- */

  const cache = new Map();
  function loadModel(url) {
    if (!cache.has(url)) {
      const job = (async () => {
        let res;
        try {
          res = await fetch(url);
        } catch {
          throw new PreviewError(location.protocol === 'file:'
            ? 'Previews work once the site is online (or served from a local web server).'
            : 'This file is hosted somewhere that doesn’t allow previews. Download it to open it in Minecraft.');
        }
        if (!res.ok) throw new PreviewError(`The file couldn’t be loaded (error ${res.status}).`);
        const data = await gunzip(await res.arrayBuffer());
        return parseLitematic(readNBT(data));
      })();
      job.catch(() => cache.delete(url));
      cache.set(url, job);
    }
    return cache.get(url);
  }

  /* ---------- UI ---------- */

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const pretty = name => name.replace(/_/g, ' ').replace(/(^|\s)(\S)/g, (_, s, ch) => s + ch.toUpperCase());
  const numberFmt = new Intl.NumberFormat();
  const rgb = c => `rgb(${c.join(',')})`;
  const SHOWN_MATERIALS = 8;

  const TEMPLATE = `
    <div class="preview-stage">
      <canvas class="preview-canvas" tabindex="0" aria-label="3D preview of the build. Drag to rotate, scroll to zoom."></canvas>
      <div class="preview-status" role="status"><span class="preview-spinner" aria-hidden="true"></span><span data-msg>Loading build…</span></div>
      <p class="preview-hint mono" hidden></p>
      <button class="icon-btn sm preview-reset" type="button" hidden aria-label="Reset view" title="Reset view">
        <svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3.5 4v4.5H8"/></svg>
      </button>
    </div>
    <div class="preview-bar" hidden>
      <label class="preview-layers">
        <span>Layers</span>
        <input type="range" min="1" step="1">
        <output class="mono"></output>
      </label>
    </div>
    <p class="preview-meta mono" hidden></p>
    <details class="preview-materials" hidden>
      <summary>Materials</summary>
      <ul></ul>
    </details>`;

  function mount(el, url) {
    el.innerHTML = TEMPLATE;
    const q = sel => el.querySelector(sel);
    const canvas = q('canvas');
    const status = q('.preview-status');
    let viewer = null;
    let destroyed = false;

    const fail = message => {
      status.hidden = false;
      status.classList.add('is-error');
      q('[data-msg]').textContent = message;
    };

    loadModel(url)
      .then(model => new Promise(resolve => setTimeout(() => resolve(model), 30)))   // let “Loading” paint first
      .then(model => {
        if (destroyed) return;
        if (!model.blocks) throw new PreviewError('This schematic is empty.');
        viewer = createViewer(canvas, model);
        viewer.setMesh(buildMesh(model, model.H));
        status.hidden = true;

        const hint = q('.preview-hint');
        hint.textContent = matchMedia('(pointer: coarse)').matches
          ? 'Drag to rotate · Pinch to zoom'
          : 'Drag to rotate · Right-drag to pan · Scroll to zoom';
        hint.hidden = false;
        canvas.addEventListener('pointerdown', () => hint.classList.add('is-faded'), { once: true });

        const resetBtn = q('.preview-reset');
        resetBtn.hidden = false;
        resetBtn.addEventListener('click', () => viewer && viewer.reset());

        if (model.H > 1) {
          const bar = q('.preview-bar');
          const range = q('input[type=range]');
          const out = q('output');
          range.max = model.H;
          range.value = model.H;
          const label = () => { out.textContent = `${range.value} / ${model.H}`; };
          label();
          let pending = 0;
          range.addEventListener('input', () => {
            label();
            if (pending) return;
            pending = requestAnimationFrame(() => {
              pending = 0;
              if (viewer) viewer.setMesh(buildMesh(model, Number(range.value)));
            });
          });
          bar.hidden = false;
        }

        const meta = q('.preview-meta');
        meta.innerHTML = [
          model.name && `<strong>${esc(model.name)}</strong>`,
          `${model.W} × ${model.H} × ${model.L}`,
          `${numberFmt.format(model.blocks)} blocks`,
          model.author && `by ${esc(model.author)}`,
        ].filter(Boolean).join('<span class="dot"></span>');
        meta.hidden = false;

        const details = q('.preview-materials');
        const list = model.materials;
        q('summary').textContent = `Materials (${list.length})`;
        q('ul').innerHTML = list.slice(0, SHOWN_MATERIALS).map(m => `
          <li><span class="swatch" style="background:${rgb(m.color)}"></span><span class="mat-name">${esc(pretty(m.name))}</span><span class="mono">${numberFmt.format(m.count)}</span></li>`).join('')
          + (list.length > SHOWN_MATERIALS ? `<li class="mat-more">+ ${list.length - SHOWN_MATERIALS} more</li>` : '');
        details.hidden = false;
        q('.mat-more')?.addEventListener('click', e => {
          e.currentTarget.remove();
          q('ul').insertAdjacentHTML('beforeend', list.slice(SHOWN_MATERIALS).map(m => `
            <li><span class="swatch" style="background:${rgb(m.color)}"></span><span class="mat-name">${esc(pretty(m.name))}</span><span class="mono">${numberFmt.format(m.count)}</span></li>`).join(''));
        });
      })
      .catch(err => {
        if (destroyed) return;
        console.warn('[preview]', err);
        fail(err instanceof PreviewError ? err.message : 'This file couldn’t be read as a Litematica schematic.');
      });

    return {
      destroy() {
        destroyed = true;
        if (viewer) viewer.destroy();
        viewer = null;
      },
    };
  }

  window.LitematicPreview = { mount };
})();

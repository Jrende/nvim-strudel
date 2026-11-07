#!/usr/
/**
 * LSP server for Strudel mini-notation
 * Provides completions, hover, diagnostics, signature help, and code actions
 */

// IMPORTANT: Patch console.log BEFORE importing @strudel/mini
// @strudel/core prints "🌀 @strudel/core loaded 🌀" to stdout on import,
// which corrupts the LSP JSON-RPC protocol. We redirect it to stderr.
const originalLog = console.log;
console.log = (...args: unknown[]) => {
  // Redirect to stderr to avoid corrupting LSP protocol
  console.error(...args);
};

import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  InitializeParams,
  TextDocumentSyncKind,
  InitializeResult,
  CompletionItem,
  CompletionItemKind,
  Hover,
  Diagnostic,
  DiagnosticSeverity,
  Position,
  Range,
  SignatureHelp,
  SignatureInformation,
  ParameterInformation,
  CodeAction,
  CodeActionKind,
  CodeActionParams,
  TextEdit,
  MarkupKind,
} from "vscode-languageserver/node.js";

import { TextDocument } from "vscode-languageserver-textdocument";

// Dynamic import for @strudel/mini to ensure console.log patch runs first
// @ts-ignore - @strudel/mini has no type declarations
const { parse: parseMini, getLeaves: getMiniLeaves } =
  await import("@strudel/mini");

// Restore console.log after imports (connection.console.log goes to the right place anyway)
console.log = originalLog;

// Create connection using stdio
const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// Dynamic sample list - will be populated from engine
let dynamicSamples: string[] = [];
let dynamicBanks: string[] = [];

// Default sample names (fallback when not connected to engine)
const DEFAULT_SAMPLE_NAMES = [
  // Drums
  "bd",
  "sd",
  "hh",
  "oh",
  "cp",
  "mt",
  "ht",
  "lt",
  "rim",
  "cb",
  "cr",
  "rd",
  "sh",
  "tb",
  "perc",
  "misc",
  "fx",
  // Piano
  "piano",
  // Synths (superdough oscillators)
  "sine",
  "saw",
  "square",
  "triangle",
  "sawtooth",
  "tri",
  "white",
  "pink",
  "brown",
  // ZZFX chip synths
  "zzfx",
  "z_sine",
  "z_sawtooth",
  "z_triangle",
  "z_square",
  "z_tan",
  "z_noise",
  // Misc samples
  "casio",
  "jazz",
  "metal",
  "east",
  "space",
  "wind",
  "insect",
  "crow",
  "numbers",
  "mridangam",
  // Instruments from VCSL
  "violin",
  "viola",
  "cello",
  "bass",
  "flute",
  "oboe",
  "clarinet",
  "bassoon",
  "trumpet",
  "horn",
  "trombone",
  "tuba",
  "glockenspiel",
  "xylophone",
  "vibraphone",
];

// Note names
const NOTE_NAMES = [
  "c",
  "d",
  "e",
  "f",
  "g",
  "a",
  "b",
  "cs",
  "ds",
  "fs",
  "gs",
  "as", // sharps
  "db",
  "eb",
  "gb",
  "ab",
  "bb", // flats
];

// Octaves
const OCTAVES = ["0", "1", "2", "3", "4", "5", "6", "7", "8"];

// Scale names
const SCALE_NAMES = [
  "major",
  "minor",
  "dorian",
  "phrygian",
  "lydian",
  "mixolydian",
  "locrian",
  "aeolian",
  "ionian",
  "harmonicMinor",
  "melodicMinor",
  "pentatonic",
  "blues",
  "chromatic",
  "wholetone",
  "diminished",
  "augmented",
  "bebop",
  "hungarian",
  "spanish",
];

// Voicing mode names (used with .mode() function)
// Format: "mode" or "mode:anchor" e.g., "above:c3"
// Single letters (u, v, w, x, y, z) are shorthand voicing modes used in chord notation like "Am:u:6"
const VOICING_MODES = [
  "above",
  "below",
  "between",
  "duck",
  "root",
  "rootless",
  "u",
  "v",
  "w",
  "x",
  "y",
  "z",
];

// Effects/modifiers in mini-notation
const MINI_OPERATORS = [
  {
    label: "*",
    detail: "Speed up (fast)",
    documentation: "Multiply speed: bd*2 plays twice as fast",
  },
  {
    label: "/",
    detail: "Slow down",
    documentation: "Divide speed: bd/2 plays twice as slow",
  },
  {
    label: "!",
    detail: "Replicate",
    documentation: "Repeat element: bd!3 plays bd three times",
  },
  {
    label: "?",
    detail: "Degrade/maybe",
    documentation: "Random chance: bd? sometimes plays",
  },
  {
    label: "@",
    detail: "Weight",
    documentation: "Set duration weight: bd@2 takes twice as long",
  },
  { label: "~", detail: "Rest/silence", documentation: "Silent step" },
  {
    label: "<>",
    detail: "Alternate",
    documentation: "Alternate between patterns each cycle",
  },
  {
    label: "[]",
    detail: "Subsequence",
    documentation: "Group elements into subsequence",
  },
  {
    label: "{}",
    detail: "Polyrhythm",
    documentation: "Play patterns in parallel with different lengths",
  },
  {
    label: "(,)",
    detail: "Euclidean rhythm",
    documentation: "Euclidean distribution: bd(3,8) = 3 hits over 8 steps",
  },
  {
    label: ":",
    detail: "Sample index",
    documentation: "Select sample variant: bd:2",
  },
  {
    label: ",",
    detail: "Parallel",
    documentation: "Play patterns in parallel: bd, hh",
  },
  {
    label: "|",
    detail: "Random choice",
    documentation: "Random choice: bd | sd",
  },
];

// Function signatures with parameters
interface FunctionSignature {
  name: string;
  detail: string;
  documentation: string;
  signatures: {
    label: string;
    documentation?: string;
    parameters: { label: string; documentation: string }[];
  }[];
}

const STRUDEL_FUNCTIONS: FunctionSignature[] = [
  {
    name: "markcss",
    detail: "markcss/tag",
    documentation:
      "<p>Overrides the css of highlighted events. Make sure to use single quotes!</p>",
    signatures: [
      {
        label: "markcss()",
        parameters: [],
      },
    ],
  },
  {
    name: "slider",
    detail: "slider/external_io,visualization",
    documentation:
      "<p>Displays a slider widget to allow the user manipulate a value</p>",
    signatures: [
      {
        label: "slider(value, min, max, step)",
        parameters: [
          {
            label: "number value",
            documentation: "<p>Initial value</p>",
          },
          {
            label: "number min",
            documentation: "<p>Minimum value - optional, defaults to 0</p>",
          },
          {
            label: "number max",
            documentation: "<p>Maximum value - optional, defaults to 1</p>",
          },
          {
            label: "number step",
            documentation: "<p>Step size - optional</p>",
          },
        ],
      },
    ],
  },
  {
    name: "s",
    detail: "s/superdough,samples",
    documentation:
      "<p>Select a sound / sample by name. When using mininotation, you can also optionally supply 'n' and 'gain' parameters\nseparated by ':'.</p>",
    signatures: [
      {
        label: "s(sound)",
        parameters: [
          {
            label: "string sound",
            documentation: "<p>The sound / pattern of sounds to pick</p>",
          },
        ],
      },
    ],
  },
  {
    name: "wt",
    detail: "wt/wavetable,superdough",
    documentation:
      "<p>Position in the wavetable of the wavetable oscillator</p>",
    signatures: [
      {
        label: "wt(position)",
        parameters: [
          {
            label: "number position",
            documentation: "<p>Position in the wavetable from 0 to 1</p>",
          },
        ],
      },
    ],
  },
  {
    name: "wtenv",
    detail: "wtenv/wavetable,envelope,superdough",
    documentation:
      "<p>Amount of envelope applied wavetable oscillator's position envelope</p>",
    signatures: [
      {
        label: "wtenv(amount)",
        parameters: [
          {
            label: "number amount",
            documentation: "<p>between 0 and 1</p>",
          },
        ],
      },
    ],
  },
  {
    name: "wtattack",
    detail: "wtattack/wavetable,envelope,superdough",
    documentation:
      "<p>Attack time of the wavetable oscillator's position envelope</p>",
    signatures: [
      {
        label: "wtattack(time)",
        parameters: [
          {
            label: "number time",
            documentation: "<p>attack time in seconds</p>",
          },
        ],
      },
    ],
  },
  {
    name: "wtdecay",
    detail: "wtdecay/wavetable,envelope,superdough",
    documentation:
      "<p>Decay time of the wavetable oscillator's position envelope</p>",
    signatures: [
      {
        label: "wtdecay(time)",
        parameters: [
          {
            label: "number time",
            documentation: "<p>decay time in seconds</p>",
          },
        ],
      },
    ],
  },
  {
    name: "wtsustain",
    detail: "wtsustain/wavetable,envelope,superdough",
    documentation:
      "<p>Sustain time of the wavetable oscillator's position envelope</p>",
    signatures: [
      {
        label: "wtsustain(gain)",
        parameters: [
          {
            label: "number gain",
            documentation: "<p>sustain level (0 to 1)</p>",
          },
        ],
      },
    ],
  },
  {
    name: "wtrelease",
    detail: "wtrelease/wavetable,envelope,superdough",
    documentation:
      "<p>Release time of the wavetable oscillator's position envelope</p>",
    signatures: [
      {
        label: "wtrelease(time)",
        parameters: [
          {
            label: "number time",
            documentation: "<p>release time in seconds</p>",
          },
        ],
      },
    ],
  },
  {
    name: "wtrate",
    detail: "wtrate/wavetable,lfo,superdough",
    documentation:
      "<p>Rate of the LFO for the wavetable oscillator's position</p>",
    signatures: [
      {
        label: "wtrate(rate)",
        parameters: [
          {
            label: "number rate",
            documentation: "<p>rate in hertz</p>",
          },
        ],
      },
    ],
  },
  {
    name: "wtsync",
    detail: "wtsync/wavetable,lfo,superdough",
    documentation:
      "<p>cycle synced rate of the LFO for the wavetable oscillator's position</p>",
    signatures: [
      {
        label: "wtsync(rate)",
        parameters: [
          {
            label: "number rate",
            documentation: "<p>rate in cycles</p>",
          },
        ],
      },
    ],
  },
  {
    name: "wtdepth",
    detail: "wtdepth/wavetable,lfo,superdough",
    documentation:
      "<p>Depth of the LFO for the wavetable oscillator's position</p>",
    signatures: [
      {
        label: "wtdepth(depth)",
        parameters: [
          {
            label: "number depth",
            documentation: "<p>depth of modulation</p>",
          },
        ],
      },
    ],
  },
  {
    name: "wtshape",
    detail: "wtshape/wavetable,lfo,superdough",
    documentation:
      "<p>Shape of the LFO for the wavetable oscillator's position</p>",
    signatures: [
      {
        label: "wtshape(shape)",
        parameters: [
          {
            label: "number shape",
            documentation: "<p>Shape of the lfo (0, 1, 2, ..)</p>",
          },
        ],
      },
    ],
  },
  {
    name: "wtdc",
    detail: "wtdc/wavetable,lfo,superdough",
    documentation:
      "<p>DC offset of the LFO for the wavetable oscillator's position</p>",
    signatures: [
      {
        label: "wtdc(dcoffset)",
        parameters: [
          {
            label: "number dcoffset",
            documentation: "<p>dc offset. set to 0 for unipolar</p>",
          },
        ],
      },
    ],
  },
  {
    name: "wtskew",
    detail: "wtskew/wavetable,lfo,superdough",
    documentation:
      "<p>Skew of the LFO for the wavetable oscillator's position</p>",
    signatures: [
      {
        label: "wtskew(skew)",
        parameters: [
          {
            label: "number skew",
            documentation: "<p>How much to bend the LFO shape</p>",
          },
        ],
      },
    ],
  },
  {
    name: "warp",
    detail: "warp/wavetable,superdough",
    documentation:
      "<p>Amount of warp (alteration of the waveform) to apply to the wavetable oscillator</p>",
    signatures: [
      {
        label: "warp(amount)",
        parameters: [
          {
            label: "number amount",
            documentation: "<p>Warp of the wavetable from 0 to 1</p>",
          },
        ],
      },
    ],
  },
  {
    name: "warpattack",
    detail: "warpattack/wavetable,envelope,superdough",
    documentation:
      "<p>Attack time of the wavetable oscillator's warp envelope</p>",
    signatures: [
      {
        label: "warpattack(time)",
        parameters: [
          {
            label: "number time",
            documentation: "<p>attack time in seconds</p>",
          },
        ],
      },
    ],
  },
  {
    name: "warpdecay",
    detail: "warpdecay/wavetable,envelope,superdough",
    documentation:
      "<p>Decay time of the wavetable oscillator's warp envelope</p>",
    signatures: [
      {
        label: "warpdecay(time)",
        parameters: [
          {
            label: "number time",
            documentation: "<p>decay time in seconds</p>",
          },
        ],
      },
    ],
  },
  {
    name: "warpsustain",
    detail: "warpsustain/wavetable,envelope,superdough",
    documentation:
      "<p>Sustain time of the wavetable oscillator's warp envelope</p>",
    signatures: [
      {
        label: "warpsustain(gain)",
        parameters: [
          {
            label: "number gain",
            documentation: "<p>sustain level (0 to 1)</p>",
          },
        ],
      },
    ],
  },
  {
    name: "warprelease",
    detail: "warprelease/wavetable,envelope,superdough",
    documentation:
      "<p>Release time of the wavetable oscillator's warp envelope</p>",
    signatures: [
      {
        label: "warprelease(time)",
        parameters: [
          {
            label: "number time",
            documentation: "<p>release time in seconds</p>",
          },
        ],
      },
    ],
  },
  {
    name: "warprate",
    detail: "warprate/wavetable,lfo,superdough",
    documentation: "<p>Rate of the LFO for the wavetable oscillator's warp</p>",
    signatures: [
      {
        label: "warprate(rate)",
        parameters: [
          {
            label: "number rate",
            documentation: "<p>rate in hertz</p>",
          },
        ],
      },
    ],
  },
  {
    name: "warpdepth",
    detail: "warpdepth/wavetable,lfo,superdough",
    documentation:
      "<p>Depth of the LFO for the wavetable oscillator's warp</p>",
    signatures: [
      {
        label: "warpdepth(depth)",
        parameters: [
          {
            label: "number depth",
            documentation: "<p>depth of modulation</p>",
          },
        ],
      },
    ],
  },
  {
    name: "warpshape",
    detail: "warpshape/wavetable,lfo,superdough",
    documentation:
      "<p>Shape of the LFO for the wavetable oscillator's warp</p>",
    signatures: [
      {
        label: "warpshape(shape)",
        parameters: [
          {
            label: "number shape",
            documentation: "<p>Shape of the lfo (0, 1, 2, ..)</p>",
          },
        ],
      },
    ],
  },
  {
    name: "warpdc",
    detail: "warpdc/wavetable,lfo,superdough",
    documentation:
      "<p>DC offset of the LFO for the wavetable oscillator's warp</p>",
    signatures: [
      {
        label: "warpdc(dcoffset)",
        parameters: [
          {
            label: "number dcoffset",
            documentation: "<p>dc offset. set to 0 for unipolar</p>",
          },
        ],
      },
    ],
  },
  {
    name: "warpskew",
    detail: "warpskew/wavetable,lfo,superdough",
    documentation: "<p>Skew of the LFO for the wavetable oscillator's warp</p>",
    signatures: [
      {
        label: "warpskew(skew)",
        parameters: [
          {
            label: "number skew",
            documentation: "<p>How much to bend the LFO shape</p>",
          },
        ],
      },
    ],
  },
  {
    name: "warpmode",
    detail: "warpmode/wavetable,superdough",
    documentation:
      "<p>Type of warp (alteration of the waveform) to apply to the wavetable oscillator.</p>\n<p>The current options are: none, asym, bendp, bendm, bendmp, sync, quant, fold, pwm, orbit,\nspin, chaos, primes, binary, brownian, reciprocal, wormhole, logistic, sigmoid, fractal, flip</p>",
    signatures: [
      {
        label: "warpmode(mode)",
        parameters: [
          {
            label: "number mode",
            documentation: "<p>Warp mode</p>",
          },
        ],
      },
    ],
  },
  {
    name: "wtphaserand",
    detail: "wtphaserand/wavetable,superdough",
    documentation:
      "<p>Amount of randomness of the initial phase of the wavetable oscillator.</p>",
    signatures: [
      {
        label: "wtphaserand(amount)",
        parameters: [
          {
            label: "number amount",
            documentation:
              "<p>Randomness of the initial phase. Between 0 (not random) and 1 (fully random)</p>",
          },
        ],
      },
    ],
  },
  {
    name: "warpenv",
    detail: "warpenv/wavetable,envelope,superdough",
    documentation:
      "<p>Amount of envelope applied wavetable oscillator's position envelope</p>",
    signatures: [
      {
        label: "warpenv(amount)",
        parameters: [
          {
            label: "number amount",
            documentation: "<p>between 0 and 1</p>",
          },
        ],
      },
    ],
  },
  {
    name: "warpsync",
    detail: "warpsync/wavetable,lfo,superdough",
    documentation:
      "<p>cycle synced rate of the LFO for the wavetable warp position</p>",
    signatures: [
      {
        label: "warpsync(rate)",
        parameters: [
          {
            label: "number rate",
            documentation: "<p>rate in cycles</p>",
          },
        ],
      },
    ],
  },
  {
    name: "source",
    detail: "source/external_io,superdough",
    documentation:
      "<p>Define a custom webaudio node to use as a sound source.</p>",
    signatures: [
      {
        label: "source(getSource)",
        parameters: [
          {
            label: "function getSource",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "n",
    detail: "n/superdough,samples,tonal",
    documentation:
      "<p>Selects the given index:</p>\n<ul>\n<li>for samples, it picks the sample by index, with wrap around</li>\n<li>for scales, it picks the scale degree</li>\n<li>for voicings, it picks the voice index</li>\n</ul>",
    signatures: [
      {
        label: "n(value)",
        parameters: [
          {
            label: "number value",
            documentation: "<p>sample index starting from 0</p>",
          },
        ],
      },
    ],
  },
  {
    name: "i",
    detail: "i/tonal",
    documentation:
      "<p>Selects the given degree. Currently used in <code>xen</code> and <code>tune</code>:</p>",
    signatures: [
      {
        label: "i(value)",
        parameters: [
          {
            label: "number value",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "note",
    detail: "note/tonal",
    documentation:
      "<p>Plays the given note name or midi number. A note name consists of</p>\n<ul>\n<li>a letter (a-g or A-G)</li>\n<li>optional accidentals (b or #)</li>\n<li>optional (possibly negative) octave number (0-9). Defaults to 3</li>\n</ul>\n<p>Examples of valid note names: <code>c</code>, <code>bb</code>, <code>Bb</code>, <code>f#</code>, <code>c3</code>, <code>A4</code>, <code>Eb2</code>, <code>c#5</code></p>\n<p>You can also use midi numbers instead of note names, where 69 is mapped to A4 440Hz in 12EDO.</p>",
    signatures: [
      {
        label: "note()",
        parameters: [],
      },
    ],
  },
  {
    name: "accelerate",
    detail: "accelerate/samples,superdirt,superdirtonly",
    documentation:
      "<p>A pattern of numbers that speed up (or slow down) samples while they play. Currently only supported by osc / superdirt.</p>",
    signatures: [
      {
        label: "accelerate(amount)",
        parameters: [
          {
            label: "number amount",
            documentation: "<p>acceleration.</p>",
          },
        ],
      },
    ],
  },
  {
    name: "velocity",
    detail: "velocity/amplitude,superdough",
    documentation:
      "<p>Sets the velocity from 0 to 1. Is multiplied together with gain.</p>",
    signatures: [
      {
        label: "velocity()",
        parameters: [],
      },
    ],
  },
  {
    name: "gain",
    detail: "gain/amplitude,superdough",
    documentation: "<p>Controls the gain by an exponential amount.</p>",
    signatures: [
      {
        label: "gain(amount)",
        parameters: [
          {
            label: "number amount",
            documentation: "<p>gain.</p>",
          },
        ],
      },
    ],
  },
  {
    name: "postgain",
    detail: "postgain/amplitude,superdough",
    documentation: "<p>Gain applied after all effects have been processed.</p>",
    signatures: [
      {
        label: "postgain()",
        parameters: [],
      },
    ],
  },
  {
    name: "amp",
    detail: "amp/amplitude,superdirt,superdirtonly",
    documentation: "<p>Like <code>gain</code>, but linear.</p>",
    signatures: [
      {
        label: "amp(amount)",
        parameters: [
          {
            label: "number amount",
            documentation: "<p>gain.</p>",
          },
        ],
      },
    ],
  },
  {
    name: "fmh",
    detail: "fmh/fm,superdough",
    documentation:
      "<p>Sets the Frequency Modulation Harmonicity Ratio.\nControls the timbre of the sound.\nWhole numbers and simple ratios sound more natural,\nwhile decimal numbers and complex ratios sound metallic.</p>\n<p>A number may be added afterwards to control the harmonicity of\nany of the 8 individual FMs (e.g. <code>fmh2</code>)</p>",
    signatures: [
      {
        label: "fmh(harmonicity)",
        parameters: [
          {
            label: "number harmonicity",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "fm",
    detail: "fm/fm,superdough",
    documentation:
      "<p>Sets the Frequency Modulation of the synth.\nControls the modulation index, which defines the brightness of the sound.</p>\n<p>A number may be added afterwards to control the modulation index of\nany of the 8 individual FMs (e.g. <code>fm3</code>). Also, FMs may be routed into\neach other with matrix commands like <code>fm13</code>, which would send <code>fm1</code> back into\n<code>fm3</code></p>",
    signatures: [
      {
        label: "fm(brightness)",
        parameters: [
          {
            label: "number brightness",
            documentation: "<p>modulation index</p>",
          },
        ],
      },
    ],
  },
  {
    name: "fmenv",
    detail: "fmenv/fm,envelope,superdough",
    documentation:
      "<p>Ramp type of fm envelope. Exp might be a bit broken..</p>\n<p>A number may be added afterwards to control the envelope of\nany of the 8 individual FMs (e.g. <code>fmenv4</code>)</p>",
    signatures: [
      {
        label: "fmenv(type)",
        parameters: [
          {
            label: "number type",
            documentation: "<p>lin | exp</p>",
          },
        ],
      },
    ],
  },
  {
    name: "fmattack",
    detail: "fmattack/fm,envelope,superdough",
    documentation:
      "<p>Attack time for the FM envelope: time it takes to reach maximum modulation</p>\n<p>A number may be added afterwards to control the attack of the envelope of\nany of the 8 individual FMs (e.g. <code>fmatt5</code>)</p>",
    signatures: [
      {
        label: "fmattack(time)",
        parameters: [
          {
            label: "number time",
            documentation: "<p>attack time</p>",
          },
        ],
      },
    ],
  },
  {
    name: "fmwave",
    detail: "fmwave/fm,superdough",
    documentation:
      "<p>Waveform of the fm modulator</p>\n<p>A number may be added afterwards to control the waveform\nany of the 8 individual FMs (e.g. <code>fmwave6</code>)</p>",
    signatures: [
      {
        label: "fmwave(wave)",
        parameters: [
          {
            label: "number wave",
            documentation: "<p>waveform</p>",
          },
        ],
      },
    ],
  },
  {
    name: "fmdecay",
    detail: "fmdecay/fm,envelope,superdough",
    documentation:
      "<p>Decay time for the FM envelope: seconds until the sustain level is reached after the attack phase.</p>\n<p>A number may be added afterwards to control the decay of the envelope of\nany of the 8 individual FMs (e.g. <code>fmdec6</code>)</p>",
    signatures: [
      {
        label: "fmdecay(time)",
        parameters: [
          {
            label: "number time",
            documentation: "<p>decay time</p>",
          },
        ],
      },
    ],
  },
  {
    name: "fmsustain",
    detail: "fmsustain/fm,envelope,superdough",
    documentation:
      "<p>Sustain level for the FM envelope: how much modulation is applied after the decay phase</p>\n<p>A number may be added afterwards to control the sustain of the envelope of\nany of the 8 individual FMs (e.g. <code>fmsus7</code>)</p>",
    signatures: [
      {
        label: "fmsustain(level)",
        parameters: [
          {
            label: "number level",
            documentation: "<p>sustain level</p>",
          },
        ],
      },
    ],
  },
  {
    name: "fmrelease",
    detail: "fmrelease/fm,envelope,superdough",
    documentation:
      "<p>Release time for the FM envelope: how much modulation is applied after the note is released</p>\n<p>A number may be added afterwards to control the release of the envelope of\nany of the 8 individual FMs (e.g. <code>fmrel8</code>)</p>",
    signatures: [
      {
        label: "fmrelease(time)",
        parameters: [
          {
            label: "number time",
            documentation: "<p>release time</p>",
          },
        ],
      },
    ],
  },
  {
    name: "bank",
    detail: "bank/samples,superdough",
    documentation:
      "<p>Select the sound bank to use. To be used together with <code>s</code>. The bank name (+ &quot;_&quot;) will be prepended to the value of <code>s</code>.</p>",
    signatures: [
      {
        label: "bank(bank)",
        parameters: [
          {
            label: "string bank",
            documentation: "<p>the name of the bank</p>",
          },
        ],
      },
    ],
  },
  {
    name: "chorus",
    detail: "chorus/pitch",
    documentation: "<p>mix control for the chorus effect</p>",
    signatures: [
      {
        label: "chorus(chorus)",
        parameters: [
          {
            label: "string chorus",
            documentation: "<p>mix amount between 0 and 1</p>",
          },
        ],
      },
    ],
  },
  {
    name: "attack",
    detail: "attack/amplitude,envelope,superdough",
    documentation:
      "<p>Amplitude envelope attack time: Specifies how long it takes for the sound to reach its peak value, relative to the onset.</p>",
    signatures: [
      {
        label: "attack(attack)",
        parameters: [
          {
            label: "number attack",
            documentation: "<p>time in seconds.</p>",
          },
        ],
      },
    ],
  },
  {
    name: "decay",
    detail: "decay/amplitude,envelope,superdough",
    documentation:
      "<p>Amplitude envelope decay time: the time it takes after the attack time to reach the sustain level.\nNote that the decay is only audible if the sustain value is lower than 1.</p>",
    signatures: [
      {
        label: "decay(time)",
        parameters: [
          {
            label: "number time",
            documentation: "<p>decay time in seconds</p>",
          },
        ],
      },
    ],
  },
  {
    name: "sustain",
    detail: "sustain/amplitude,envelope,superdough",
    documentation:
      "<p>Amplitude envelope sustain level: The level which is reached after attack / decay, being sustained until the offset.</p>",
    signatures: [
      {
        label: "sustain(gain)",
        parameters: [
          {
            label: "number gain",
            documentation: "<p>sustain level between 0 and 1</p>",
          },
        ],
      },
    ],
  },
  {
    name: "release",
    detail: "release/amplitude,envelope,superdough",
    documentation:
      "<p>Amplitude envelope release time: The time it takes after the offset to go from sustain level to zero.</p>",
    signatures: [
      {
        label: "release(time)",
        parameters: [
          {
            label: "number time",
            documentation: "<p>release time in seconds</p>",
          },
        ],
      },
    ],
  },
  {
    name: "bpf",
    detail: "bpf/filter,superdough",
    documentation:
      "<p>Sets the center frequency of the <strong>b</strong>and-<strong>p</strong>ass <strong>f</strong>ilter. When using mininotation, you\ncan also optionally supply the 'bpq' parameter separated by ':'.</p>",
    signatures: [
      {
        label: "bpf(frequency)",
        parameters: [
          {
            label: "number frequency",
            documentation: "<p>center frequency</p>",
          },
        ],
      },
    ],
  },
  {
    name: "bpq",
    detail: "bpq/filter,superdough",
    documentation:
      "<p>Sets the <strong>b</strong>and-<strong>p</strong>ass <strong>q</strong>-factor (resonance).</p>",
    signatures: [
      {
        label: "bpq(q)",
        parameters: [
          {
            label: "number q",
            documentation: "<p>q factor</p>",
          },
        ],
      },
    ],
  },
  {
    name: "begin",
    detail: "begin/samples",
    documentation:
      "<p>A pattern of numbers from 0 to 1. Skips the beginning of each sample, e.g. <code>0.25</code> to cut off the first quarter from each sample.</p>",
    signatures: [
      {
        label: "begin(amount)",
        parameters: [
          {
            label: "number amount",
            documentation:
              "<p>between 0 and 1, where 1 is the length of the sample</p>",
          },
        ],
      },
    ],
  },
  {
    name: "end",
    detail: "Pattern.end/samples",
    documentation:
      "<p>The same as .begin, but cuts off the end off each sample.</p>",
    signatures: [
      {
        label: "end(length)",
        parameters: [
          {
            label: "number length",
            documentation:
              "<p>1 = whole sample, .5 = half sample, .25 = quarter sample etc..</p>",
          },
        ],
      },
    ],
  },
  {
    name: "loop",
    detail: "loop/samples",
    documentation:
      "<p>Loops the sample.\nNote that the tempo of the loop is not synced with the cycle tempo.\nTo change the loop region, use loopBegin / loopEnd.</p>",
    signatures: [
      {
        label: "loop(on)",
        parameters: [
          {
            label: "number on",
            documentation: "<p>If 1, the sample is looped</p>",
          },
        ],
      },
    ],
  },
  {
    name: "loopBegin",
    detail: "loopBegin/samples",
    documentation:
      "<p>Begin to loop at a specific point in the sample (inbetween <code>begin</code> and <code>end</code>).\nNote that the loop point must be inbetween <code>begin</code> and <code>end</code>, and before <code>loopEnd</code>!\nNote: Samples starting with wt_ will automatically loop! (wt = wavetable)</p>",
    signatures: [
      {
        label: "loopBegin(time)",
        parameters: [
          {
            label: "number time",
            documentation:
              "<p>between 0 and 1, where 1 is the length of the sample</p>",
          },
        ],
      },
    ],
  },
  {
    name: "loopEnd",
    detail: "loopEnd/samples",
    documentation:
      "<p>End the looping section at a specific point in the sample (inbetween <code>begin</code> and <code>end</code>).\nNote that the loop point must be inbetween <code>begin</code> and <code>end</code>, and after <code>loopBegin</code>!</p>",
    signatures: [
      {
        label: "loopEnd(time)",
        parameters: [
          {
            label: "number time",
            documentation:
              "<p>between 0 and 1, where 1 is the length of the sample</p>",
          },
        ],
      },
    ],
  },
  {
    name: "crush",
    detail: "crush/superdough",
    documentation: "<p>Bit crusher effect.</p>",
    signatures: [
      {
        label: "crush(depth)",
        parameters: [
          {
            label: "number depth",
            documentation:
              "<p>between 1 (for drastic reduction in bit-depth) to 16 (for barely no reduction).</p>",
          },
        ],
      },
    ],
  },
  {
    name: "coarse",
    detail: "coarse/superdough",
    documentation:
      "<p>Fake-resampling for lowering the sample rate. Caution: This effect seems to only work in chromium based browsers</p>",
    signatures: [
      {
        label: "coarse(factor)",
        parameters: [
          {
            label: "number factor",
            documentation:
              "<p>1 for original 2 for half, 3 for a third and so on.</p>",
          },
        ],
      },
    ],
  },
  {
    name: "tremolo",
    detail: "tremolo/amplitude,lfo,superdough",
    documentation:
      "<p>Modulate the amplitude of a sound with a continuous waveform</p>",
    signatures: [
      {
        label: "tremolo(speed)",
        parameters: [
          {
            label: "number speed",
            documentation: "<p>modulation speed in HZ</p>",
          },
        ],
      },
    ],
  },
  {
    name: "tremolosync",
    detail: "tremolosync/amplitude,lfo,superdough",
    documentation:
      "<p>Modulate the amplitude of a sound with a continuous waveform</p>",
    signatures: [
      {
        label: "tremolosync(cycles)",
        parameters: [
          {
            label: "number cycles",
            documentation: "<p>modulation speed in cycles</p>",
          },
        ],
      },
    ],
  },
  {
    name: "tremolodepth",
    detail: "tremolodepth/amplitude,lfo,superdough",
    documentation: "<p>Depth of amplitude modulation</p>",
    signatures: [
      {
        label: "tremolodepth(depth)",
        parameters: [
          {
            label: "number depth",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "tremoloskew",
    detail: "tremoloskew/amplitude,lfo,superdough",
    documentation: "<p>Alter the shape of the modulation waveform</p>",
    signatures: [
      {
        label: "tremoloskew(amount)",
        parameters: [
          {
            label: "number amount",
            documentation:
              "<p>between 0 &amp; 1, the shape of the waveform</p>",
          },
        ],
      },
    ],
  },
  {
    name: "tremolophase",
    detail: "tremolophase/amplitude,lfo,superdough",
    documentation: "<p>Alter the phase of the modulation waveform</p>",
    signatures: [
      {
        label: "tremolophase(offset)",
        parameters: [
          {
            label: "number offset",
            documentation: "<p>the offset in cycles of the modulation</p>",
          },
        ],
      },
    ],
  },
  {
    name: "tremoloshape",
    detail: "tremoloshape/amplitude,lfo,superdough",
    documentation: "<p>Shape of amplitude modulation</p>",
    signatures: [
      {
        label: "tremoloshape(shape)",
        parameters: [
          {
            label: "number shape",
            documentation: "<p>tri | square | sine | saw | ramp</p>",
          },
        ],
      },
    ],
  },
  {
    name: "drive",
    detail: "drive/filter,superdough",
    documentation: "<p>Filter overdrive for supported filter types</p>",
    signatures: [
      {
        label: "drive(amount)",
        parameters: [
          {
            label: "number amount",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "duckorbit",
    detail: "duckorbit/amplitude,orbit,superdough",
    documentation:
      "<p>Modulate the amplitude of an orbit to create a &quot;sidechain&quot; like effect.</p>\n<p>Can be applied to multiple orbits with the ':' mininotation, e.g. <code>duckorbit(&quot;2:3&quot;)</code></p>",
    signatures: [
      {
        label: "duckorbit(orbit)",
        parameters: [
          {
            label: "number orbit",
            documentation: "<p>target orbit</p>",
          },
        ],
      },
    ],
  },
  {
    name: "duckdepth",
    detail: "duckdepth/amplitude,orbit,superdough",
    documentation:
      "<p>The amount of ducking applied to target orbit</p>\n<p>Can vary across orbits with the ':' mininotation, e.g. <code>duckdepth(&quot;0.3:0.1&quot;)</code>.\nNote: this requires first applying the effect to multiple orbits with e.g. <code>duckorbit(&quot;2:3&quot;)</code>.</p>",
    signatures: [
      {
        label: "duckdepth(depth)",
        parameters: [
          {
            label: "number depth",
            documentation: "<p>depth of modulation from 0 to 1</p>",
          },
        ],
      },
    ],
  },
  {
    name: "duckonset",
    detail: "duckonset/amplitude,envelope,orbit,superdough",
    documentation:
      "<p>The time required for the ducked signal(s) to reach their lowest volume.\nCan be used to prevent clicking or for creative rhythmic effects.</p>\n<p>Can vary across orbits with the ':' mininotation, e.g. <code>duckonset(&quot;0:0.003&quot;)</code>.\nNote: this requires first applying the effect to multiple orbits with e.g. <code>duckorbit(&quot;2:3&quot;)</code>.</p>",
    signatures: [
      {
        label: "duckonset(time)",
        parameters: [
          {
            label: "number time",
            documentation: "<p>The onset time in seconds</p>",
          },
        ],
      },
    ],
  },
  {
    name: "duckattack",
    detail: "duckattack/amplitude,envelope,orbit,superdough",
    documentation:
      "<p>The time required for the ducked signal(s) to return to their normal volume.</p>\n<p>Can vary across orbits with the ':' mininotation, e.g. <code>duckonset(&quot;0:0.003&quot;)</code>.\nNote: this requires first applying the effect to multiple orbits with e.g. <code>duckorbit(&quot;2:3&quot;)</code>.</p>",
    signatures: [
      {
        label: "duckattack(time)",
        parameters: [
          {
            label: "number time",
            documentation: "<p>The attack time in seconds</p>",
          },
        ],
      },
    ],
  },
  {
    name: "byteBeatExpression",
    detail: "byteBeatExpression/superdough",
    documentation: "<p>Create byte beats with custom expressions</p>",
    signatures: [
      {
        label: "byteBeatExpression(byteBeatExpression)",
        parameters: [
          {
            label: "number byteBeatExpression",
            documentation: "<p>bitwise expression for creating bytebeat</p>",
          },
        ],
      },
    ],
  },
  {
    name: "byteBeatStartTime",
    detail: "byteBeatStartTime/superdough",
    documentation: "<p>Create byte beats with custom expressions</p>",
    signatures: [
      {
        label: "byteBeatStartTime(byteBeatStartTime)",
        parameters: [
          {
            label: "number byteBeatStartTime",
            documentation: "<p>in samples (t)</p>",
          },
        ],
      },
    ],
  },
  {
    name: "channels",
    detail: "channels/external_io,superdough",
    documentation:
      "<p>Allows you to set the output channels on the interface</p>",
    signatures: [
      {
        label: "channels(channels)",
        parameters: [
          {
            label: "number channels",
            documentation: "<p>pattern the output channels</p>",
          },
        ],
      },
    ],
  },
  {
    name: "pw",
    detail: "pw/superdough",
    documentation: "<p>Controls the pulsewidth of the pulse oscillator</p>",
    signatures: [
      {
        label: "pw(pulsewidth)",
        parameters: [
          {
            label: "number pulsewidth",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "pwrate",
    detail: "pwrate/superdough,lfo",
    documentation:
      "<p>Controls the lfo rate for the pulsewidth of the pulse oscillator</p>",
    signatures: [
      {
        label: "pwrate(rate)",
        parameters: [
          {
            label: "number rate",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "pwsweep",
    detail: "pwsweep/superdough,lfo",
    documentation:
      "<p>Controls the lfo sweep for the pulsewidth of the pulse oscillator</p>",
    signatures: [
      {
        label: "pwsweep(sweep)",
        parameters: [
          {
            label: "number sweep",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "phaser",
    detail: "phaser/superdough",
    documentation:
      "<p>Phaser audio effect that approximates popular guitar pedals.</p>",
    signatures: [
      {
        label: "phaser(speed)",
        parameters: [
          {
            label: "number speed",
            documentation: "<p>speed of modulation</p>",
          },
        ],
      },
    ],
  },
  {
    name: "phasersweep",
    detail: "phasersweep/superdough,lfo",
    documentation:
      "<p>The frequency sweep range of the lfo for the phaser effect. Defaults to 2000</p>",
    signatures: [
      {
        label: "phasersweep(phasersweep)",
        parameters: [
          {
            label: "number phasersweep",
            documentation: "<p>most useful values are between 0 and 4000</p>",
          },
        ],
      },
    ],
  },
  {
    name: "phasercenter",
    detail: "phasercenter/superdough",
    documentation:
      "<p>The center frequency of the phaser in HZ. Defaults to 1000</p>",
    signatures: [
      {
        label: "phasercenter(centerfrequency)",
        parameters: [
          {
            label: "number centerfrequency",
            documentation: "<p>in HZ</p>",
          },
        ],
      },
    ],
  },
  {
    name: "phaserdepth",
    detail: "phaserdepth/superdough,superdirt",
    documentation:
      "<p>The amount the signal is affected by the phaser effect. Defaults to 0.75</p>",
    signatures: [
      {
        label: "phaserdepth(depth)",
        parameters: [
          {
            label: "number depth",
            documentation: "<p>number between 0 and 1</p>",
          },
        ],
      },
    ],
  },
  {
    name: "channel",
    detail: "channel/superdough",
    documentation: "<p>Choose the channel the pattern is sent to</p>",
    signatures: [
      {
        label: "channel(channel)",
        parameters: [
          {
            label: "number channel",
            documentation: "<p>channel number</p>",
          },
        ],
      },
    ],
  },
  {
    name: "cut",
    detail: "cut/superdough",
    documentation:
      "<p>In the style of classic drum-machines, <code>cut</code> will stop a playing sample as soon as another samples with in same cutgroup is to be played. An example would be an open hi-hat followed by a closed one, essentially muting the open.</p>",
    signatures: [
      {
        label: "cut(group)",
        parameters: [
          {
            label: "number group",
            documentation: "<p>cut group number</p>",
          },
        ],
      },
    ],
  },
  {
    name: "lpf",
    detail: "lpf/filter,superdough",
    documentation:
      "<p>Applies the cutoff frequency of the <strong>l</strong>ow-<strong>p</strong>ass <strong>f</strong>ilter.</p>\n<p>When using mininotation, you can also optionally add the 'lpq' parameter, separated by ':'.</p>",
    signatures: [
      {
        label: "lpf(frequency)",
        parameters: [
          {
            label: "number frequency",
            documentation: "<p>audible between 0 and 20000</p>",
          },
        ],
      },
    ],
  },
  {
    name: "lpenv",
    detail: "lpenv/filter,envelope,superdough",
    documentation: "<p>Sets the lowpass filter envelope modulation depth.</p>",
    signatures: [
      {
        label: "lpenv(modulation)",
        parameters: [
          {
            label: "number modulation",
            documentation:
              "<p>depth of the lowpass filter envelope between 0 and <em>n</em></p>",
          },
        ],
      },
    ],
  },
  {
    name: "hpenv",
    detail: "hpenv/filter,envelope,superdough",
    documentation: "<p>Sets the highpass filter envelope modulation depth.</p>",
    signatures: [
      {
        label: "hpenv(modulation)",
        parameters: [
          {
            label: "number modulation",
            documentation:
              "<p>depth of the highpass filter envelope between 0 and <em>n</em></p>",
          },
        ],
      },
    ],
  },
  {
    name: "bpenv",
    detail: "bpenv/filter,envelope,superdough",
    documentation: "<p>Sets the bandpass filter envelope modulation depth.</p>",
    signatures: [
      {
        label: "bpenv(modulation)",
        parameters: [
          {
            label: "number modulation",
            documentation:
              "<p>depth of the bandpass filter envelope between 0 and <em>n</em></p>",
          },
        ],
      },
    ],
  },
  {
    name: "lpattack",
    detail: "lpattack/filter,envelope,superdough",
    documentation:
      "<p>Sets the attack duration for the lowpass filter envelope.</p>",
    signatures: [
      {
        label: "lpattack(attack)",
        parameters: [
          {
            label: "number attack",
            documentation: "<p>time of the filter envelope</p>",
          },
        ],
      },
    ],
  },
  {
    name: "hpattack",
    detail: "hpattack/filter,envelope,superdough",
    documentation:
      "<p>Sets the attack duration for the highpass filter envelope.</p>",
    signatures: [
      {
        label: "hpattack(attack)",
        parameters: [
          {
            label: "number attack",
            documentation: "<p>time of the highpass filter envelope</p>",
          },
        ],
      },
    ],
  },
  {
    name: "bpattack",
    detail: "bpattack/filter,envelope,superdough",
    documentation:
      "<p>Sets the attack duration for the bandpass filter envelope.</p>",
    signatures: [
      {
        label: "bpattack(attack)",
        parameters: [
          {
            label: "number attack",
            documentation: "<p>time of the bandpass filter envelope</p>",
          },
        ],
      },
    ],
  },
  {
    name: "lpdecay",
    detail: "lpdecay/filter,envelope,superdough",
    documentation:
      "<p>Sets the decay duration for the lowpass filter envelope.</p>",
    signatures: [
      {
        label: "lpdecay(decay)",
        parameters: [
          {
            label: "number decay",
            documentation: "<p>time of the filter envelope</p>",
          },
        ],
      },
    ],
  },
  {
    name: "hpdecay",
    detail: "hpdecay/filter,envelope,superdough",
    documentation:
      "<p>Sets the decay duration for the highpass filter envelope.</p>",
    signatures: [
      {
        label: "hpdecay(decay)",
        parameters: [
          {
            label: "number decay",
            documentation: "<p>time of the highpass filter envelope</p>",
          },
        ],
      },
    ],
  },
  {
    name: "bpdecay",
    detail: "bpdecay/filter,envelope,superdough",
    documentation:
      "<p>Sets the decay duration for the bandpass filter envelope.</p>",
    signatures: [
      {
        label: "bpdecay(decay)",
        parameters: [
          {
            label: "number decay",
            documentation: "<p>time of the bandpass filter envelope</p>",
          },
        ],
      },
    ],
  },
  {
    name: "lpsustain",
    detail: "lpsustain/filter,envelope,superdough",
    documentation:
      "<p>Sets the sustain amplitude for the lowpass filter envelope.</p>",
    signatures: [
      {
        label: "lpsustain(sustain)",
        parameters: [
          {
            label: "number sustain",
            documentation: "<p>amplitude of the lowpass filter envelope</p>",
          },
        ],
      },
    ],
  },
  {
    name: "hpsustain",
    detail: "hpsustain/filter,envelope,superdough",
    documentation:
      "<p>Sets the sustain amplitude for the highpass filter envelope.</p>",
    signatures: [
      {
        label: "hpsustain(sustain)",
        parameters: [
          {
            label: "number sustain",
            documentation: "<p>amplitude of the highpass filter envelope</p>",
          },
        ],
      },
    ],
  },
  {
    name: "bpsustain",
    detail: "bpsustain/filter,envelope,superdough",
    documentation:
      "<p>Sets the sustain amplitude for the bandpass filter envelope.</p>",
    signatures: [
      {
        label: "bpsustain(sustain)",
        parameters: [
          {
            label: "number sustain",
            documentation: "<p>amplitude of the bandpass filter envelope</p>",
          },
        ],
      },
    ],
  },
  {
    name: "lprelease",
    detail: "lprelease/filter,envelope,superdough",
    documentation:
      "<p>Sets the release time for the lowpass filter envelope.</p>",
    signatures: [
      {
        label: "lprelease(release)",
        parameters: [
          {
            label: "number release",
            documentation: "<p>time of the filter envelope</p>",
          },
        ],
      },
    ],
  },
  {
    name: "hprelease",
    detail: "hprelease/filter,envelope,superdough",
    documentation:
      "<p>Sets the release time for the highpass filter envelope.</p>",
    signatures: [
      {
        label: "hprelease(release)",
        parameters: [
          {
            label: "number release",
            documentation: "<p>time of the highpass filter envelope</p>",
          },
        ],
      },
    ],
  },
  {
    name: "bprelease",
    detail: "bprelease/filter,envelope,superdough",
    documentation:
      "<p>Sets the release time for the bandpass filter envelope.</p>",
    signatures: [
      {
        label: "bprelease(release)",
        parameters: [
          {
            label: "number release",
            documentation: "<p>time of the bandpass filter envelope</p>",
          },
        ],
      },
    ],
  },
  {
    name: "ftype",
    detail: "ftype/filter,superdough",
    documentation:
      "<p>Sets the filter type. The ladder filter is more aggressive. More types might be added in the future.</p>",
    signatures: [
      {
        label: "ftype(type)",
        parameters: [
          {
            label: "number type",
            documentation: "<p>12db (0), ladder (1), or 24db (2)</p>",
          },
        ],
      },
    ],
  },
  {
    name: "fanchor",
    detail: "fanchor/filter,envelope,superdough",
    documentation:
      "<p>controls the center of the filter envelope. 0 is unipolar positive, .5 is bipolar, 1 is unipolar negative</p>",
    signatures: [
      {
        label: "fanchor(center)",
        parameters: [
          {
            label: "number center",
            documentation: "<p>0 to 1</p>",
          },
        ],
      },
    ],
  },
  {
    name: "hpf",
    detail: "hpf/filter,superdough",
    documentation:
      "<p>Applies the cutoff frequency of the <strong>h</strong>igh-<strong>p</strong>ass <strong>f</strong>ilter.</p>\n<p>When using mininotation, you can also optionally add the 'hpq' parameter, separated by ':'.</p>",
    signatures: [
      {
        label: "hpf(frequency)",
        parameters: [
          {
            label: "number frequency",
            documentation: "<p>audible between 0 and 20000</p>",
          },
        ],
      },
    ],
  },
  {
    name: "lprate",
    detail: "lprate/filter,lfo,superdough",
    documentation: "<p>Rate of the LFO for the lowpass filter</p>",
    signatures: [
      {
        label: "lprate(rate)",
        parameters: [
          {
            label: "number rate",
            documentation: "<p>rate in hertz</p>",
          },
        ],
      },
    ],
  },
  {
    name: "lpsync",
    detail: "lpsync/filter,lfo,superdough",
    documentation: "<p>Cycle-synced rate of the LFO for the lowpass filter</p>",
    signatures: [
      {
        label: "lpsync(rate)",
        parameters: [
          {
            label: "number rate",
            documentation: "<p>rate in cycles</p>",
          },
        ],
      },
    ],
  },
  {
    name: "lpdepth",
    detail: "lpdepth/filter,lfo,superdough",
    documentation: "<p>Depth of the LFO for the lowpass filter</p>",
    signatures: [
      {
        label: "lpdepth(depth)",
        parameters: [
          {
            label: "number depth",
            documentation: "<p>depth of modulation</p>",
          },
        ],
      },
    ],
  },
  {
    name: "lpdepthfrequency",
    detail: "lpdepthfrequency/filter,lfo,superdough",
    documentation: "<p>Depth of the LFO for the lowpass filter, in HZ</p>",
    signatures: [
      {
        label: "lpdepthfrequency(depth)",
        parameters: [
          {
            label: "number depth",
            documentation: "<p>depth of modulation</p>",
          },
        ],
      },
    ],
  },
  {
    name: "lpshape",
    detail: "lpshape/filter,lfo,superdough",
    documentation: "<p>Shape of the LFO for the lowpass filter</p>",
    signatures: [
      {
        label: "lpshape(shape)",
        parameters: [
          {
            label: "number shape",
            documentation: "<p>Shape of the lfo (0, 1, 2, ..)</p>",
          },
        ],
      },
    ],
  },
  {
    name: "lpdc",
    detail: "lpdc/filter,lfo,superdough",
    documentation: "<p>DC offset of the LFO for the lowpass filter</p>",
    signatures: [
      {
        label: "lpdc(dcoffset)",
        parameters: [
          {
            label: "number dcoffset",
            documentation: "<p>dc offset. set to 0 for unipolar</p>",
          },
        ],
      },
    ],
  },
  {
    name: "lpskew",
    detail: "lpskew/filter,lfo,superdough",
    documentation: "<p>Skew of the LFO for the lowpass filter</p>",
    signatures: [
      {
        label: "lpskew(skew)",
        parameters: [
          {
            label: "number skew",
            documentation: "<p>How much to bend the LFO shape</p>",
          },
        ],
      },
    ],
  },
  {
    name: "bprate",
    detail: "bprate/filter,lfo,superdough",
    documentation: "<p>Rate of the LFO for the bandpass filter</p>",
    signatures: [
      {
        label: "bprate(rate)",
        parameters: [
          {
            label: "number rate",
            documentation: "<p>rate in hertz</p>",
          },
        ],
      },
    ],
  },
  {
    name: "bpsync",
    detail: "bpsync/filter,lfo,superdough",
    documentation:
      "<p>Cycle-synced rate of the LFO for the bandpass filter</p>",
    signatures: [
      {
        label: "bpsync(rate)",
        parameters: [
          {
            label: "number rate",
            documentation: "<p>rate in cycles</p>",
          },
        ],
      },
    ],
  },
  {
    name: "bpdepth",
    detail: "bpdepth/filter,lfo,superdough",
    documentation: "<p>Depth of the LFO for the bandpass filter</p>",
    signatures: [
      {
        label: "bpdepth(depth)",
        parameters: [
          {
            label: "number depth",
            documentation: "<p>depth of modulation</p>",
          },
        ],
      },
    ],
  },
  {
    name: "bpdepthfrequency",
    detail: "bpdepthfrequency/filter,lfo,superdough",
    documentation: "<p>Depth of the LFO for the bandpass filter, in HZ</p>",
    signatures: [
      {
        label: "bpdepthfrequency(depth)",
        parameters: [
          {
            label: "number depth",
            documentation: "<p>depth of modulation</p>",
          },
        ],
      },
    ],
  },
  {
    name: "bpshape",
    detail: "bpshape/filter,lfo,superdough",
    documentation: "<p>Shape of the LFO for the bandpass filter</p>",
    signatures: [
      {
        label: "bpshape(shape)",
        parameters: [
          {
            label: "number shape",
            documentation: "<p>Shape of the lfo (0, 1, 2, ..)</p>",
          },
        ],
      },
    ],
  },
  {
    name: "bpdc",
    detail: "bpdc/filter,lfo,superdough",
    documentation: "<p>DC offset of the LFO for the bandpass filter</p>",
    signatures: [
      {
        label: "bpdc(dcoffset)",
        parameters: [
          {
            label: "number dcoffset",
            documentation: "<p>dc offset. set to 0 for unipolar</p>",
          },
        ],
      },
    ],
  },
  {
    name: "bpskew",
    detail: "bpskew/filter,lfo,superdough",
    documentation: "<p>Skew of the LFO for the bandpass filter</p>",
    signatures: [
      {
        label: "bpskew(skew)",
        parameters: [
          {
            label: "number skew",
            documentation: "<p>How much to bend the LFO shape</p>",
          },
        ],
      },
    ],
  },
  {
    name: "hprate",
    detail: "hprate/filter,lfo,superdough",
    documentation: "<p>Rate of the LFO for the highpass filter</p>",
    signatures: [
      {
        label: "hprate(rate)",
        parameters: [
          {
            label: "number rate",
            documentation: "<p>rate in hertz</p>",
          },
        ],
      },
    ],
  },
  {
    name: "hpsync",
    detail: "hpsync/filter,lfo,superdough",
    documentation:
      "<p>Cycle-synced rate of the LFO for the highpass filter</p>",
    signatures: [
      {
        label: "hpsync(rate)",
        parameters: [
          {
            label: "number rate",
            documentation: "<p>rate in cycles</p>",
          },
        ],
      },
    ],
  },
  {
    name: "hpdepth",
    detail: "hpdepth/filter,lfo,superdough",
    documentation: "<p>Depth of the LFO for the highpass filter</p>",
    signatures: [
      {
        label: "hpdepth(depth)",
        parameters: [
          {
            label: "number depth",
            documentation: "<p>depth of modulation</p>",
          },
        ],
      },
    ],
  },
  {
    name: "hpdepthfrequency",
    detail: "hpdepthfrequency/filter,lfo,superdough",
    documentation: "<p>Depth of the LFO for the hipass filter, in hz</p>",
    signatures: [
      {
        label: "hpdepthfrequency(depth)",
        parameters: [
          {
            label: "number depth",
            documentation: "<p>depth of modulation</p>",
          },
        ],
      },
    ],
  },
  {
    name: "hpshape",
    detail: "hpshape/filter,lfo,superdough",
    documentation: "<p>Shape of the LFO for the highpass filter</p>",
    signatures: [
      {
        label: "hpshape(shape)",
        parameters: [
          {
            label: "number shape",
            documentation: "<p>Shape of the lfo (0, 1, 2, ..)</p>",
          },
        ],
      },
    ],
  },
  {
    name: "hpdc",
    detail: "hpdc/filter,lfo,superdough",
    documentation: "<p>DC offset of the LFO for the highpass filter</p>",
    signatures: [
      {
        label: "hpdc(dcoffset)",
        parameters: [
          {
            label: "number dcoffset",
            documentation: "<p>dc offset. set to 0 for unipolar</p>",
          },
        ],
      },
    ],
  },
  {
    name: "hpskew",
    detail: "hpskew/filter,lfo,superdough",
    documentation: "<p>Skew of the LFO for the highpass filter</p>",
    signatures: [
      {
        label: "hpskew(skew)",
        parameters: [
          {
            label: "number skew",
            documentation: "<p>How much to bend the LFO shape</p>",
          },
        ],
      },
    ],
  },
  {
    name: "vib",
    detail: "vib/pitch,lfo,superdough",
    documentation:
      "<p>Applies a vibrato to the frequency of the oscillator.</p>",
    signatures: [
      {
        label: "vib(frequency)",
        parameters: [
          {
            label: "number frequency",
            documentation: "<p>of the vibrato in hertz</p>",
          },
        ],
      },
    ],
  },
  {
    name: "noise",
    detail: "noise/generators,superdough",
    documentation: "<p>Adds pink noise to the mix</p>",
    signatures: [
      {
        label: "noise(wet)",
        parameters: [
          {
            label: "number wet",
            documentation: "<p>wet amount</p>",
          },
        ],
      },
    ],
  },
  {
    name: "vibmod",
    detail: "vibmod/pitch,lfo,superdough",
    documentation:
      "<p>Sets the vibrato depth in semitones. Only has an effect if <code>vibrato</code> | <code>vib</code> | <code>v</code> is is also set</p>",
    signatures: [
      {
        label: "vibmod(depth)",
        parameters: [
          {
            label: "number depth",
            documentation: "<p>of vibrato (in semitones)</p>",
          },
        ],
      },
    ],
  },
  {
    name: "hpq",
    detail: "hpq/filter,superdough",
    documentation:
      "<p>Controls the <strong>h</strong>igh-<strong>p</strong>ass <strong>q</strong>-value.</p>",
    signatures: [
      {
        label: "hpq(q)",
        parameters: [
          {
            label: "number q",
            documentation: "<p>resonance factor between 0 and 50</p>",
          },
        ],
      },
    ],
  },
  {
    name: "lpq",
    detail: "lpq/filter,superdough",
    documentation:
      "<p>Controls the <strong>l</strong>ow-<strong>p</strong>ass <strong>q</strong>-value.</p>",
    signatures: [
      {
        label: "lpq(q)",
        parameters: [
          {
            label: "number q",
            documentation: "<p>resonance factor between 0 and 50</p>",
          },
        ],
      },
    ],
  },
  {
    name: "djf",
    detail: "djf/filter,superdough",
    documentation:
      "<p>DJ filter, below 0.5 is low pass filter, above is high pass filter.</p>",
    signatures: [
      {
        label: "djf(cutoff)",
        parameters: [
          {
            label: "number cutoff",
            documentation:
              "<p>below 0.5 is low pass filter, above is high pass filter</p>",
          },
        ],
      },
    ],
  },
  {
    name: "delay",
    detail: "delay/orbit,superdough",
    documentation:
      "<p>Sets the level of the delay signal.</p>\n<p>When using mininotation, you can also optionally add the 'delaytime' and 'delayfeedback' parameter,\nseparated by ':'.</p>",
    signatures: [
      {
        label: "delay(level)",
        parameters: [
          {
            label: "number level",
            documentation: "<p>between 0 and 1</p>",
          },
        ],
      },
    ],
  },
  {
    name: "delayfeedback",
    detail: "delayfeedback/orbit,superdough",
    documentation:
      "<p>Sets the level of the signal that is fed back into the delay.\nCaution: Values &gt;= 1 will result in a signal that gets louder and louder! Don't do it</p>",
    signatures: [
      {
        label: "delayfeedback(feedback)",
        parameters: [
          {
            label: "number feedback",
            documentation: "<p>between 0 and 1</p>",
          },
        ],
      },
    ],
  },
  {
    name: "delaytime",
    detail: "delaytime/orbit,superdough",
    documentation: "<p>Sets the time of the delay effect in seconds.</p>",
    signatures: [
      {
        label: "delaytime(delay)",
        parameters: [
          {
            label: "number delay",
            documentation: "<p>in seconds</p>",
          },
        ],
      },
    ],
  },
  {
    name: "delaysync",
    detail: "delaysync/orbit,superdough",
    documentation: "<p>Sets the time of the delay effect in cycles.</p>",
    signatures: [
      {
        label: "delaysync(cycles)",
        parameters: [
          {
            label: "number cycles",
            documentation: "<p>delay length in cycles</p>",
          },
        ],
      },
    ],
  },
  {
    name: "lock",
    detail: "lock/superdirt,superdirtonly",
    documentation:
      "<p>Specifies whether delaytime is calculated relative to cps.</p>",
    signatures: [
      {
        label: "lock(enable)",
        parameters: [
          {
            label: "number enable",
            documentation:
              "<p>When set to 1, delaytime is a direct multiple of a cycle.</p>",
          },
        ],
      },
    ],
  },
  {
    name: "detune",
    detail: "detune/pitch,superdough",
    documentation:
      "<p>Set detune for stacked voices of supported oscillators.</p>",
    signatures: [
      {
        label: "detune(amount)",
        parameters: [
          {
            label: "number amount",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "unison",
    detail: "unison/superdough",
    documentation:
      "<p>Set number of stacked voices for supported oscillators.</p>",
    signatures: [
      {
        label: "unison(numvoices)",
        parameters: [
          {
            label: "number numvoices",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "spread",
    detail: "spread/superdough",
    documentation: "<p>Set the stereo pan spread for supported oscillators</p>",
    signatures: [
      {
        label: "spread(spread)",
        parameters: [
          {
            label: "number spread",
            documentation: "<p>between 0 and 1</p>",
          },
        ],
      },
    ],
  },
  {
    name: "dry",
    detail: "dry/superdirt,superdough",
    documentation:
      "<p>Set dryness of reverb. See <code>room</code> and <code>size</code> for more information about reverb.</p>",
    signatures: [
      {
        label: "dry(dry)",
        parameters: [
          {
            label: "number dry",
            documentation: "<p>0 = wet, 1 = dry</p>",
          },
        ],
      },
    ],
  },
  {
    name: "fadeTime",
    detail: "fadeTime/superdirt",
    documentation:
      "<p>Used when using <code>begin</code>/<code>end</code> or <code>chop</code>/<code>striate</code> and friends, to change the fade out time of the 'grain' envelope.</p>",
    signatures: [
      {
        label: "fadeTime(time)",
        parameters: [
          {
            label: "number time",
            documentation: "<p>between 0 and 1</p>",
          },
        ],
      },
    ],
  },
  {
    name: "freq",
    detail: "freq/pitch,superdough",
    documentation: "<p>Set frequency of sound.</p>",
    signatures: [
      {
        label: "freq(frequency)",
        parameters: [
          {
            label: "number frequency",
            documentation:
              "<p>in Hz. the audible range is between 20 and 20000 Hz</p>",
          },
        ],
      },
    ],
  },
  {
    name: "pattack",
    detail: "pattack/pitch,envelope,superdough",
    documentation: "<p>Attack time of pitch envelope.</p>",
    signatures: [
      {
        label: "pattack(time)",
        parameters: [
          {
            label: "number time",
            documentation: "<p>time in seconds</p>",
          },
        ],
      },
    ],
  },
  {
    name: "pdecay",
    detail: "pdecay/pitch,envelope,superdough",
    documentation: "<p>Decay time of pitch envelope.</p>",
    signatures: [
      {
        label: "pdecay(time)",
        parameters: [
          {
            label: "number time",
            documentation: "<p>time in seconds</p>",
          },
        ],
      },
    ],
  },
  {
    name: "prelease",
    detail: "prelease/pitch,envelope,superdough",
    documentation: "<p>Release time of pitch envelope</p>",
    signatures: [
      {
        label: "prelease(time)",
        parameters: [
          {
            label: "number time",
            documentation: "<p>time in seconds</p>",
          },
        ],
      },
    ],
  },
  {
    name: "penv",
    detail: "penv/pitch,envelope,superdough",
    documentation:
      "<p>Amount of pitch envelope. Negative values will flip the envelope.\nIf you don't set other pitch envelope controls, <code>pattack:.2</code> will be the default.</p>",
    signatures: [
      {
        label: "penv(semitones)",
        parameters: [
          {
            label: "number semitones",
            documentation: "<p>change in semitones</p>",
          },
        ],
      },
    ],
  },
  {
    name: "pcurve",
    detail: "pcurve/pitch,envelope,superdough",
    documentation:
      "<p>Curve of envelope. Defaults to linear. exponential is good for kicks</p>",
    signatures: [
      {
        label: "pcurve(type)",
        parameters: [
          {
            label: "number type",
            documentation: "<p>0 = linear, 1 = exponential</p>",
          },
        ],
      },
    ],
  },
  {
    name: "panchor",
    detail: "panchor/pitch,envelope,superdough",
    documentation:
      "<p>Sets the range anchor of the envelope:</p>\n<ul>\n<li>anchor 0: range = [note, note + penv]</li>\n<li>anchor 1: range = [note - penv, note]\nIf you don't set an anchor, the value will default to the psustain value.</li>\n</ul>",
    signatures: [
      {
        label: "panchor(anchor)",
        parameters: [
          {
            label: "number anchor",
            documentation: "<p>anchor offset</p>",
          },
        ],
      },
    ],
  },
  {
    name: "leslie",
    detail: "leslie/superdirt,superdirtonly",
    documentation:
      "<p>Emulation of a Leslie speaker: speakers rotating in a wooden amplified cabinet.</p>",
    signatures: [
      {
        label: "leslie(wet)",
        parameters: [
          {
            label: "number wet",
            documentation: "<p>between 0 and 1</p>",
          },
        ],
      },
    ],
  },
  {
    name: "lrate",
    detail: "lrate/superdirt,superdirtonly",
    documentation: "<p>Rate of modulation / rotation for leslie effect</p>",
    signatures: [
      {
        label: "lrate(rate)",
        parameters: [
          {
            label: "number rate",
            documentation: "<p>6.7 for fast, 0.7 for slow</p>",
          },
        ],
      },
    ],
  },
  {
    name: "lsize",
    detail: "lsize/superdirt,superdirtonly",
    documentation:
      "<p>Physical size of the cabinet in meters. Be careful, it might be slightly larger than your computer. Affects the Doppler amount (pitch warble)</p>",
    signatures: [
      {
        label: "lsize(meters)",
        parameters: [
          {
            label: "number meters",
            documentation: "<p>somewhere between 0 and 1</p>",
          },
        ],
      },
    ],
  },
  {
    name: "label",
    detail: "label/visualization",
    documentation:
      "<p>Sets the displayed text for an event on the pianoroll</p>",
    signatures: [
      {
        label: "label(label)",
        parameters: [
          {
            label: "string label",
            documentation: "<p>text to display</p>",
          },
        ],
      },
    ],
  },
  {
    name: "octave",
    detail: "octave/superdirt",
    documentation: "<p>Sets the default octave of a synth.</p>",
    signatures: [
      {
        label: "octave(octave)",
        parameters: [
          {
            label: "number octave",
            documentation: "<p>octave number</p>",
          },
        ],
      },
    ],
  },
  {
    name: "orbit",
    detail: "orbit/superdough",
    documentation:
      "<p>An <code>orbit</code> is a global parameter context for patterns. Patterns with the same orbit will share the same global effects.</p>",
    signatures: [
      {
        label: "orbit(number)",
        parameters: [
          {
            label: "number number",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "bus",
    detail: "bus/superdough",
    documentation:
      "<p>A <code>bus</code> is a send which can be used for mixing patterns. It combines with..\ns(&quot;bus&quot;) to play that bus through another pattern (for, say, applying non-linear\neffects like distortion to multiple signals)</p>\n<p>otherPat.bmod(..) (to modulate another pattern with the bus)</p>",
    signatures: [
      {
        label: "bus(number)",
        parameters: [
          {
            label: "number number",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "busgain",
    detail: "busgain/superdough",
    documentation:
      "<p>Postgain multiplier prior to sending the signal to the audio bus.</p>",
    signatures: [
      {
        label: "busgain(number)",
        parameters: [
          {
            label: "number number",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "pan",
    detail: "pan/superdough",
    documentation: "<p>Sets position in stereo.</p>",
    signatures: [
      {
        label: "pan(pan)",
        parameters: [
          {
            label: "number pan",
            documentation:
              "<p>between 0 and 1, from left to right (assuming stereo), once round a circle (assuming multichannel)</p>",
          },
        ],
      },
    ],
  },
  {
    name: "panspan",
    detail: "panspan/superdirt",
    documentation: "<p>Controls how much multichannel output is fanned out</p>",
    signatures: [
      {
        label: "panspan(span)",
        parameters: [
          {
            label: "number span",
            documentation:
              "<p>between -inf and inf, negative is backwards ordering</p>",
          },
        ],
      },
    ],
  },
  {
    name: "pansplay",
    detail: "pansplay/superdirt",
    documentation: "<p>Controls how much multichannel output is spread</p>",
    signatures: [
      {
        label: "pansplay(spread)",
        parameters: [
          {
            label: "number spread",
            documentation: "<p>between 0 and 1</p>",
          },
        ],
      },
    ],
  },
  {
    name: "chord",
    detail: "chord/tonal",
    documentation: "<p>The chord to voice</p>",
    signatures: [
      {
        label: "chord(symbols)",
        parameters: [
          {
            label: "string symbols",
            documentation:
              "<p>chord symbols to voice e.g., C, Eb, Fm7, G7. The symbols can be defined via addVoicings</p>",
          },
        ],
      },
    ],
  },
  {
    name: "dictionary",
    detail: "dictionary/tonal",
    documentation:
      "<p>Which dictionary to use for the voicings. This falls back to the default dictionary if not provided</p>",
    signatures: [
      {
        label: "dictionary(dictionaryName)",
        parameters: [
          {
            label: "string dictionaryName",
            documentation:
              "<p>which dictionary (having been defined with <code>addVoicings</code>) to use</p>",
          },
        ],
      },
    ],
  },
  {
    name: "anchor",
    detail: "anchor/tonal",
    documentation:
      "<p>The top note to align the voicing to. Defaults to c5</p>",
    signatures: [
      {
        label: "anchor(anchorNote)",
        parameters: [
          {
            label: "string anchorNote",
            documentation: "<p>the note to align the voicing or scale to</p>",
          },
        ],
      },
    ],
  },
  {
    name: "offset",
    detail: "offset/tonal",
    documentation:
      "<p>Sets how the voicing is offset from the anchored position</p>",
    signatures: [
      {
        label: "offset(shift)",
        parameters: [
          {
            label: "number shift",
            documentation: "<p>the amount to shift the voicing up or down</p>",
          },
        ],
      },
    ],
  },
  {
    name: "octaves",
    detail: "octaves/tonal",
    documentation:
      "<p>How many octaves are voicing steps spread apart, defaults to 1</p>",
    signatures: [
      {
        label: "octaves(count)",
        parameters: [
          {
            label: "number count",
            documentation: "<p>the number of octaves</p>",
          },
        ],
      },
    ],
  },
  {
    name: "mode",
    detail: "mode/tonal",
    documentation:
      "<p>How the voicing is aligned to the anchor</p>\n<ul>\n<li>\n<p><code>below</code>: top note &lt;= anchor</p>\n</li>\n<li>\n<p><code>duck</code>: top note &lt;= anchor, anchor excluded</p>\n</li>\n<li>\n<p><code>above</code>: bottom note &gt;= anchor</p>\n</li>\n<li>\n<p><code>root</code>: bottom note is the lowest root of the chord &gt;= anchor</p>\n</li>\n<li>\n<p><code>oldabove</code> : old (buggy) behavior of above, kept for legacy reason</p>\n</li>\n<li>\n<p><code>oldroot</code> : old (buggy) behavior of root, kept for legacy reason</p>\n</li>\n</ul>",
    signatures: [
      {
        label: "mode(modeName)",
        parameters: [
          {
            label: "string modeName",
            documentation:
              "<p>one of {below | above | duck | root | oldabove | oldroot}</p>",
          },
        ],
      },
    ],
  },
  {
    name: "room",
    detail: "room/orbit,superdough",
    documentation:
      "<p>Sets the level of reverb.</p>\n<p>When using mininotation, you can also optionally add the 'size' parameter, separated by ':'.</p>",
    signatures: [
      {
        label: "room(level)",
        parameters: [
          {
            label: "number level",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "roomlp",
    detail: "roomlp/orbit,superdough",
    documentation:
      "<p>Reverb lowpass starting frequency (in hertz).\nWhen this property is changed, the reverb will be recaculated, so only change this sparsely..</p>",
    signatures: [
      {
        label: "roomlp(frequency)",
        parameters: [
          {
            label: "number frequency",
            documentation: "<p>between 0 and 20000hz</p>",
          },
        ],
      },
    ],
  },
  {
    name: "roomdim",
    detail: "roomdim/orbit,superdough",
    documentation:
      "<p>Reverb lowpass frequency at -60dB (in hertz).\nWhen this property is changed, the reverb will be recaculated, so only change this sparsely..</p>",
    signatures: [
      {
        label: "roomdim(frequency)",
        parameters: [
          {
            label: "number frequency",
            documentation: "<p>between 0 and 20000hz</p>",
          },
        ],
      },
    ],
  },
  {
    name: "roomfade",
    detail: "roomfade/orbit,superdough",
    documentation:
      "<p>Reverb fade time (in seconds).\nWhen this property is changed, the reverb will be recaculated, so only change this sparsely..</p>",
    signatures: [
      {
        label: "roomfade(seconds)",
        parameters: [
          {
            label: "number seconds",
            documentation: "<p>for the reverb to fade</p>",
          },
        ],
      },
    ],
  },
  {
    name: "iresponse",
    detail: "iresponse/orbit,superdough",
    documentation:
      "<p>Sets the sample to use as an impulse response for the reverb.</p>",
    signatures: [
      {
        label: "iresponse(sample)",
        parameters: [
          {
            label: "string sample",
            documentation: "<p>to use as an impulse response</p>",
          },
        ],
      },
    ],
  },
  {
    name: "irspeed",
    detail: "irspeed/orbit,superdough",
    documentation: "<p>Sets speed of the sample for the impulse response.</p>",
    signatures: [
      {
        label: "irspeed(speed)",
        parameters: [
          {
            label: "string speed",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "irbegin",
    detail: "irbegin/orbit,superdough",
    documentation: "<p>Sets the beginning of the IR response sample</p>",
    signatures: [
      {
        label: "irbegin(begin)",
        parameters: [
          {
            label: "string begin",
            documentation: "<p>between 0 and 1</p>",
          },
        ],
      },
    ],
  },
  {
    name: "roomsize",
    detail: "roomsize/orbit,superdough",
    documentation:
      "<p>Sets the room size of the reverb, see <code>room</code>.\nWhen this property is changed, the reverb will be recaculated, so only change this sparsely..</p>",
    signatures: [
      {
        label: "roomsize(size)",
        parameters: [
          {
            label: "number size",
            documentation: "<p>between 0 and 10</p>",
          },
        ],
      },
    ],
  },
  {
    name: "shape",
    detail: "shape/distortion,superdough",
    documentation:
      "<p>(Deprecated) Wave shaping distortion. WARNING: can suddenly get unpredictably loud.\nPlease use distort instead, which has a more predictable response curve\nsecond option in optional array syntax (ex: &quot;.9:.5&quot;) applies a postgain to the output</p>",
    signatures: [
      {
        label: "shape(distortion)",
        parameters: [
          {
            label: "number distortion",
            documentation: "<p>between 0 and 1</p>",
          },
        ],
      },
    ],
  },
  {
    name: "distort",
    detail: "distort/distortion,superdough",
    documentation:
      "<p>Wave shaping distortion. CAUTION: it can get loud.\nSecond option in optional array syntax (ex: &quot;.9:.5&quot;) applies a postgain to the output. Third option sets the waveshaping type.\nMost useful values are usually between 0 and 10 (depending on source gain). If you are feeling adventurous, you can turn it up to 11 and beyond ;)</p>",
    signatures: [
      {
        label: "distort(distortion, volume, type)",
        parameters: [
          {
            label: "number distortion",
            documentation: "<p>amount of distortion to apply</p>",
          },
          {
            label: "number volume",
            documentation: "<p>linear postgain of the distortion</p>",
          },
          {
            label: "number type",
            documentation: "<p>type of distortion to apply</p>",
          },
        ],
      },
    ],
  },
  {
    name: "distortvol",
    detail: "distortvol/superdough",
    documentation: "<p>Postgain for waveshaping distortion.</p>",
    signatures: [
      {
        label: "distortvol(volume)",
        parameters: [
          {
            label: "number volume",
            documentation: "<p>linear postgain of the distortion</p>",
          },
        ],
      },
    ],
  },
  {
    name: "distorttype",
    detail: "distorttype/distortion,superdough",
    documentation: "<p>Type of waveshaping distortion to apply.</p>",
    signatures: [
      {
        label: "distorttype(type)",
        parameters: [
          {
            label: "number type",
            documentation: "<p>type of distortion to apply</p>",
          },
        ],
      },
    ],
  },
  {
    name: "compressor",
    detail: "compressor/superdough",
    documentation:
      '<p>Dynamics Compressor. The params are <code>compressor(&quot;threshold:ratio:knee:attack:release&quot;)</code>\nMore info <a href="https://developer.mozilla.org/en-US/docs/Web/API/DynamicsCompressorNode?retiredLocale=de#instance_properties">here</a></p>',
    signatures: [
      {
        label: "compressor()",
        parameters: [],
      },
    ],
  },
  {
    name: "speed",
    detail: "speed/pitch,samples",
    documentation:
      "<p>Changes the speed of sample playback, i.e. a cheap way of changing pitch.</p>",
    signatures: [
      {
        label: "speed(speed)",
        parameters: [
          {
            label: "number speed",
            documentation:
              "<p>inf to inf, negative numbers play the sample backwards.</p>",
          },
        ],
      },
    ],
  },
  {
    name: "stretch",
    detail: "stretch/pitch,samples",
    documentation:
      "<p>Changes the pitch of the sample without changing its speed.\nThe frequencies are multiplied by (factor + 1) for positive numbers\nand by max(factor / 4 + 1, 0) for negative numbers.\nSo tuning up by octaves can be done with 1, 3, 7, ...\nand tuning down by octaves with -2, -3, -3.5...</p>",
    signatures: [
      {
        label: "stretch(factor)",
        parameters: [
          {
            label: "number factor",
            documentation:
              "<p>between <code>-4</code> and <code>inf</code>. Positive increases pitch, 0 does nothing, negative decreases the pitch.</p>",
          },
        ],
      },
    ],
  },
  {
    name: "unit",
    detail: "unit/superdirt,superdirtonly",
    documentation:
      "<p>Used in conjunction with <code>speed</code>, accepts values of &quot;r&quot; (rate, default behavior), &quot;c&quot; (cycles), or &quot;s&quot; (seconds). Using <code>unit &quot;c&quot;</code> means <code>speed</code> will be interpreted in units of cycles, e.g. <code>speed &quot;1&quot;</code> means samples will be stretched to fill a cycle. Using <code>unit &quot;s&quot;</code> means the playback speed will be adjusted so that the duration is the number of seconds specified by <code>speed</code>.</p>",
    signatures: [
      {
        label: "unit(unit)",
        parameters: [
          {
            label: "number unit",
            documentation: "<p>see description above</p>",
          },
        ],
      },
    ],
  },
  {
    name: "squiz",
    detail: "squiz/superdirt,superdirtonly",
    documentation:
      "<p>Made by Calum Gunn. Reminiscent of some weird mixture of filter, ring-modulator and pitch-shifter. The SuperCollider manual defines Squiz as:</p>\n<p>&quot;A simplistic pitch-raising algorithm. It's not meant to sound natural; its sound is reminiscent of some weird mixture of filter, ring-modulator and pitch-shifter, depending on the input. The algorithm works by cutting the signal into fragments (delimited by upwards-going zero-crossings) and squeezing those fragments in the time domain (i.e. simply playing them back faster than they came in), leaving silences inbetween. All the parameters apart from memlen can be modulated.&quot;</p>",
    signatures: [
      {
        label: "squiz(squiz)",
        parameters: [
          {
            label: "number squiz",
            documentation:
              "<p>Try passing multiples of 2 to it - 2, 4, 8 etc.</p>",
          },
        ],
      },
    ],
  },
  {
    name: "vowel",
    detail: "vowel/superdough",
    documentation: "<p>Formant filter to make things sound like vowels.</p>",
    signatures: [
      {
        label: "vowel(vowel)",
        parameters: [
          {
            label: "string vowel",
            documentation:
              "<p>You can use a e i o u ae aa oe ue y uh un en an on, corresponding to [a] [e] [i] [o] [u] [æ] [ɑ] [ø] [y] [ɯ] [ʌ] [œ̃] [ɛ̃] [ɑ̃] [ɔ̃]. Aliases: aa = å = ɑ, oe = ø = ö, y = ı, ae = æ.</p>",
          },
        ],
      },
    ],
  },
  {
    name: "density",
    detail: "density/superdough",
    documentation: "<p>crackle noise density</p>",
    signatures: [
      {
        label: "density(density)",
        parameters: [
          {
            label: "number density",
            documentation: "<p>between 0 and x</p>",
          },
        ],
      },
    ],
  },
  {
    name: "clip",
    detail: "clip/superdough",
    documentation:
      "<p>Multiplies the duration with the given number. Also cuts samples off at the end if they exceed the duration.</p>",
    signatures: [
      {
        label: "clip(factor)",
        parameters: [
          {
            label: "number factor",
            documentation: "<blockquote>\n<p>= 0</p>\n</blockquote>",
          },
        ],
      },
    ],
  },
  {
    name: "duration",
    detail: "duration/superdough",
    documentation:
      "<p>Sets the duration of the event in cycles. Similar to clip / legato, it also cuts samples off at the end if they exceed the duration.</p>",
    signatures: [
      {
        label: "duration(seconds)",
        parameters: [
          {
            label: "number seconds",
            documentation: "<blockquote>\n<p>= 0</p>\n</blockquote>",
          },
        ],
      },
    ],
  },
  {
    name: "color",
    detail: "color/visualization",
    documentation:
      "<p>Sets the color of the hap in visualizations like pianoroll or highlighting.</p>",
    signatures: [
      {
        label: "color(color)",
        parameters: [
          {
            label: "string color",
            documentation: "<p>Hexadecimal or CSS color name</p>",
          },
        ],
      },
    ],
  },
  {
    name: "adsr",
    detail: "adsr/envelope,amplitude",
    documentation:
      "<p>ADSR envelope: Combination of Attack, Decay, Sustain, and Release.</p>",
    signatures: [
      {
        label: "adsr(time, time, gain, time)",
        parameters: [
          {
            label: "number time",
            documentation: "<p>attack time in seconds</p>",
          },
          {
            label: "number time",
            documentation: "<p>decay time in seconds</p>",
          },
          {
            label: "number gain",
            documentation: "<p>sustain level (0 to 1)</p>",
          },
          {
            label: "number time",
            documentation: "<p>release time in seconds</p>",
          },
        ],
      },
    ],
  },
  {
    name: "midichan",
    detail: "midichan/external_io,midi",
    documentation: "<p>MIDI channel: Sets the MIDI channel for the event.</p>",
    signatures: [
      {
        label: "midichan(channel)",
        parameters: [
          {
            label: "number channel",
            documentation: "<p>MIDI channel number (0-15)</p>",
          },
        ],
      },
    ],
  },
  {
    name: "midiport",
    detail: "midiport/external_io,midi",
    documentation: "<p>MIDI port: Sets the MIDI port for the event.</p>",
    signatures: [
      {
        label: "midiport(port)",
        parameters: [
          {
            label: "number port",
            documentation: "<p>MIDI port</p>",
          },
        ],
      },
    ],
  },
  {
    name: "midicmd",
    detail: "midicmd/external_io,midi",
    documentation: "<p>MIDI command: Sends a MIDI command message.</p>",
    signatures: [
      {
        label: "midicmd(command)",
        parameters: [
          {
            label: "number command",
            documentation: "<p>MIDI command</p>",
          },
        ],
      },
    ],
  },
  {
    name: "control",
    detail: "control/external_io,midi",
    documentation: "<p>MIDI control: Sends a MIDI control change message.</p>",
    signatures: [
      {
        label: "control(MIDI, MIDI)",
        parameters: [
          {
            label: "number MIDI",
            documentation: "<p>control number (0-127)</p>",
          },
          {
            label: "number MIDI",
            documentation: "<p>controller value (0-127)</p>",
          },
        ],
      },
    ],
  },
  {
    name: "ccn",
    detail: "ccn/external_io,midi",
    documentation:
      "<p>MIDI control number: Sends a MIDI control change message.</p>",
    signatures: [
      {
        label: "ccn(MIDI)",
        parameters: [
          {
            label: "number MIDI",
            documentation: "<p>control number (0-127)</p>",
          },
        ],
      },
    ],
  },
  {
    name: "ccv",
    detail: "ccv/external_io,midi",
    documentation:
      "<p>MIDI control value: Sends a MIDI control change message.</p>",
    signatures: [
      {
        label: "ccv(MIDI)",
        parameters: [
          {
            label: "number MIDI",
            documentation: "<p>control value (0-127)</p>",
          },
        ],
      },
    ],
  },
  {
    name: "nrpnn",
    detail: "nrpnn/external_io,midi",
    documentation:
      "<p>MIDI NRPN non-registered parameter number: Sends a MIDI NRPN non-registered parameter number message.</p>",
    signatures: [
      {
        label: "nrpnn(nrpnn)",
        parameters: [
          {
            label: "number nrpnn",
            documentation:
              "<p>MIDI NRPN non-registered parameter number (0-127)</p>",
          },
        ],
      },
    ],
  },
  {
    name: "nrpv",
    detail: "nrpv/external_io,midi",
    documentation:
      "<p>MIDI NRPN non-registered parameter value: Sends a MIDI NRPN non-registered parameter value message.</p>",
    signatures: [
      {
        label: "nrpv(nrpv)",
        parameters: [
          {
            label: "number nrpv",
            documentation:
              "<p>MIDI NRPN non-registered parameter value (0-127)</p>",
          },
        ],
      },
    ],
  },
  {
    name: "progNum",
    detail: "progNum/external_io",
    documentation:
      "<p>MIDI program number: Sends a MIDI program change message.</p>",
    signatures: [
      {
        label: "progNum(program)",
        parameters: [
          {
            label: "number program",
            documentation: "<p>MIDI program number (0-127)</p>",
          },
        ],
      },
    ],
  },
  {
    name: "sysex",
    detail: "sysex/external_io,midi",
    documentation: "<p>MIDI sysex: Sends a MIDI sysex message.</p>",
    signatures: [
      {
        label: "sysex(id, data)",
        parameters: [
          {
            label: "number id",
            documentation: "<p>Sysex ID</p>",
          },
          {
            label: "number data",
            documentation: "<p>Sysex data</p>",
          },
        ],
      },
    ],
  },
  {
    name: "sysexid",
    detail: "sysexid/external_io,midi",
    documentation:
      "<p>MIDI sysex ID: Sends a MIDI sysex identifier message.</p>",
    signatures: [
      {
        label: "sysexid(id)",
        parameters: [
          {
            label: "number id",
            documentation: "<p>Sysex ID</p>",
          },
        ],
      },
    ],
  },
  {
    name: "sysexdata",
    detail: "sysexdata/external_io,midi",
    documentation: "<p>MIDI sysex data: Sends a MIDI sysex message.</p>",
    signatures: [
      {
        label: "sysexdata(data)",
        parameters: [
          {
            label: "number data",
            documentation: "<p>Sysex data</p>",
          },
        ],
      },
    ],
  },
  {
    name: "midibend",
    detail: "midibend/external_io,midi",
    documentation: "<p>MIDI pitch bend: Sends a MIDI pitch bend message.</p>",
    signatures: [
      {
        label: "midibend(midibend)",
        parameters: [
          {
            label: "number midibend",
            documentation: "<p>MIDI pitch bend (-1 - 1)</p>",
          },
        ],
      },
    ],
  },
  {
    name: "miditouch",
    detail: "miditouch/external_io,midi",
    documentation:
      "<p>MIDI key after touch: Sends a MIDI key after touch message.</p>",
    signatures: [
      {
        label: "miditouch(miditouch)",
        parameters: [
          {
            label: "number miditouch",
            documentation: "<p>MIDI key after touch (0-1)</p>",
          },
        ],
      },
    ],
  },
  {
    name: "oschost",
    detail: "oschost/external_io",
    documentation:
      "<p>The host to send open sound control messages to. Requires running the OSC bridge.</p>",
    signatures: [
      {
        label: "oschost(oschost)",
        parameters: [
          {
            label: "string oschost",
            documentation: "<p>e.g. 'localhost'</p>",
          },
        ],
      },
    ],
  },
  {
    name: "oscport",
    detail: "oscport/external_io",
    documentation:
      "<p>The port to send open sound control messages to. Requires running the OSC bridge.</p>",
    signatures: [
      {
        label: "oscport(oscport)",
        parameters: [
          {
            label: "number oscport",
            documentation: "<p>e.g. 57120</p>",
          },
        ],
      },
    ],
  },
  {
    name: "as",
    detail: "as/combiners",
    documentation: "<p>Sets properties in a batch.</p>",
    signatures: [
      {
        label: "as(mapping)",
        parameters: [
          {
            label: "String mapping",
            documentation: "<p>the control names that are set</p>",
          },
        ],
      },
    ],
  },
  {
    name: "scrub",
    detail: "Pattern.scrub/samples",
    documentation:
      "<p>Allows you to scrub an audio file like a tape loop by passing values that represents the position in the audio file\nin the optional array syntax ex: &quot;0.5:2&quot;, the second value controls the speed of playback</p>",
    signatures: [
      {
        label: "scrub()",
        parameters: [],
      },
    ],
  },
  {
    name: "lfo",
    detail: "lfo/lfo,superdough",
    documentation:
      "<p>Configures an LFO. Can be called in sequence like pat.lfo(...).lfo(...) to set up multiple LFOs.\nThere are two ways to declare which control will be modulated:</p>\n<ol>\n<li>Explicitly put <code>control</code> in the config (e.g. <code>lfo({ c: &quot;lpf&quot; })</code>)</li>\n<li>If the control parameter is absent, the control <em>immediately before</em> the <code>lfo</code> call will be used\n(e.g. <code>s(&quot;saw&quot;).lpf(500).lfo()</code> to modulate <code>lpf</code>)</li>\n</ol>\n<p>Modulators can be referred to by <code>id</code> so that they can be updated later e.g. inside\na <code>sometimes</code>. See example below.</p>",
    signatures: [
      {
        label:
          "lfo(config, config.control, config.subControl, config.rate, config.sync, config.depth, config.depthabs, config.dcoffset, config.shape, config.skew, config.curve, config.retrig, config.fxi, id)",
        parameters: [
          {
            label: "Object config",
            documentation: "<p>LFO configuration.</p>",
          },
          {
            label: "string config.control",
            documentation: "<p>Node to modulate. Aliases: c</p>",
          },
          {
            label: "string config.subControl",
            documentation:
              "<p>Sub-control name to append to the control key. Aliases: sc</p>",
          },
          {
            label: "number config.rate",
            documentation: "<p>Modulation rate. Aliases: r</p>",
          },
          {
            label: "number config.sync",
            documentation: "<p>Tempo-synced modulation rate. Aliases: s</p>",
          },
          {
            label: "number config.depth",
            documentation: "<p>Relative modulation depth. Aliases: dep, dr</p>",
          },
          {
            label: "number config.depthabs",
            documentation: "<p>Absolute modulation depth. Aliases: da</p>",
          },
          {
            label: "number config.dcoffset",
            documentation:
              "<p>DC offset / bias for the waveform. Aliases: dc</p>",
          },
          {
            label: "number config.shape",
            documentation: "<p>Shape index. Aliases: sh</p>",
          },
          {
            label: "number config.skew",
            documentation: "<p>Skew amount. Aliases: sk</p>",
          },
          {
            label: "number config.curve",
            documentation: "<p>Exponential curve amount. Aliases: cu</p>",
          },
          {
            label: "number config.retrig",
            documentation:
              "<p>If &gt; 0.5, the LFO will retrigger on each event. Aliases: rt</p>",
          },
          {
            label: "number config.fxi",
            documentation: "<p>FX index to target</p>",
          },
          {
            label: "string id",
            documentation: "<p>ID to use for this modulator</p>",
          },
        ],
      },
    ],
  },
  {
    name: "env",
    detail: "env/envelope,superdough",
    documentation:
      "<p>Configures an envelope. Can be called in sequence like pat.env(...).env(...) to set up multiple envelopes\nThere are two ways to declare which control will be modulated:</p>\n<ol>\n<li>Explicitly put <code>control</code> in the config (e.g. <code>env({ c: &quot;lpf&quot; })</code>)</li>\n<li>If the control parameter is absent, the control <em>immediately before</em> the <code>env</code> call will be used\n(e.g. <code>s(&quot;saw&quot;).lpf(500).env({ a: 1 })</code> to modulate <code>lpf</code>)</li>\n</ol>\n<p>Modulators can be referred to by <code>id</code> so that they can be updated later e.g. inside\na <code>sometimes</code>. See example below.</p>",
    signatures: [
      {
        label:
          "env(config, config.control, config.subControl, config.depth, config.depthabs, config.attack, config.decay, config.sustain, config.release, config.acurve, config.dcurve, config.rcurve, config.fxi, id)",
        parameters: [
          {
            label: "Object config",
            documentation: "<p>Envelope configuration.</p>",
          },
          {
            label: "string config.control",
            documentation: "<p>Node to modulate. Aliases: c</p>",
          },
          {
            label: "string config.subControl",
            documentation:
              "<p>Sub-control name to append to the control key. Aliases: sc</p>",
          },
          {
            label: "number config.depth",
            documentation: "<p>Relative modulation depth. Aliases: dep, dr</p>",
          },
          {
            label: "number config.depthabs",
            documentation: "<p>Absolute modulation depth. Aliases: da</p>",
          },
          {
            label: "number config.attack",
            documentation: "<p>Time to reach depth. Aliases: att, a</p>",
          },
          {
            label: "number config.decay",
            documentation: "<p>Time to reach sustain. Aliases: dec, d</p>",
          },
          {
            label: "number config.sustain",
            documentation: "<p>Sustain depth. Aliases: sus, s</p>",
          },
          {
            label: "number config.release",
            documentation:
              "<p>Time to return to nominal value. Aliases: rel, r</p>",
          },
          {
            label: "number config.acurve",
            documentation:
              "<p>Snappiness of attack curve (-1 = relaxed, 1 = snappy). Aliases: ac</p>",
          },
          {
            label: "number config.dcurve",
            documentation:
              "<p>Snappiness of decay curve (-1 = relaxed, 1 = snappy). Aliases: dc</p>",
          },
          {
            label: "number config.rcurve",
            documentation:
              "<p>Snappiness of release curve (-1 = relaxed, 1 = snappy). Aliases: rc</p>",
          },
          {
            label: "number config.fxi",
            documentation: "<p>FX index to target</p>",
          },
          {
            label: "string id",
            documentation: "<p>ID to use for this modulator</p>",
          },
        ],
      },
    ],
  },
  {
    name: "bmod",
    detail: "bmod/superdough",
    documentation:
      "<p>Modulates with the output from a given <code>bus</code>.\nCan be called in sequence like pat.bmod(...).bmod(...) to set up multiple modulators</p>\n<p>Send to an audio bus with <code>otherPat.bus(..)</code>.</p>\n<p>There are two ways to declare which control will be modulated:</p>\n<ol>\n<li>Explicitly put <code>control</code> in the config (e.g. <code>bmod({ id: 2, c: &quot;lpf&quot; })</code>)</li>\n<li>If the control parameter is absent, the control <em>immediately before</em> the <code>bmod</code> call will be used\n(e.g. <code>s(&quot;saw&quot;).lpf(500).bmod({ id: 2 })</code> to modulate <code>lpf</code>)</li>\n</ol>\n<p>Modulators can be referred to by <code>id</code> so that they can be updated later e.g. inside\na <code>sometimes</code>. See example below.</p>",
    signatures: [
      {
        label:
          "bmod(config, config.bus, config.control, config.subControl, config.depth, config.depthabs, config.dc, config.fxi, id)",
        parameters: [
          {
            label: "Object config",
            documentation: "<p>Bus modulation configuration.</p>",
          },
          {
            label: "string config.bus",
            documentation: "<p>Bus to get modulation signal from</p>",
          },
          {
            label: "string config.control",
            documentation: "<p>Node to modulate. Aliases: c</p>",
          },
          {
            label: "string config.subControl",
            documentation:
              "<p>Sub-control name to append to the control key. Aliases: sc</p>",
          },
          {
            label: "number config.depth",
            documentation: "<p>Relative modulation depth. Aliases: dep, dr</p>",
          },
          {
            label: "number config.depthabs",
            documentation: "<p>Absolute modulation depth. Aliases: da</p>",
          },
          {
            label: "number config.dc",
            documentation: "<p>DC offset prior to application</p>",
          },
          {
            label: "number config.fxi",
            documentation: "<p>FX index to target</p>",
          },
          {
            label: "string id",
            documentation: "<p>ID to use for this modulator</p>",
          },
        ],
      },
    ],
  },
  {
    name: "transient",
    detail: "transient/superdough",
    documentation:
      "<p>Transient shaper. Gives independent control over the emphasis on transients\nand sustains</p>",
    signatures: [
      {
        label: "transient(attack, sustain)",
        parameters: [
          {
            label: "number attack",
            documentation:
              "<p>Emphasis on transients; between -1 (deaccentuate) and 1 (accentuate)</p>",
          },
          {
            label: "number sustain",
            documentation:
              "<p>Emphasis on the sustains; between -1 (deaccentuate) and 1 (accentuate)</p>",
          },
        ],
      },
    ],
  },
  {
    name: "drawLine",
    detail: "drawLine/visualization",
    documentation:
      "<p>Intended for a debugging, drawLine renders the pattern as a string, where each character represents the same time span.\nShould only be used with single characters as values, otherwise the character slots will be messed up.\nCharacter legend:</p>\n<ul>\n<li>&quot;|&quot; cycle separator</li>\n<li>&quot;-&quot; hold previous value</li>\n<li>&quot;.&quot; silence</li>\n</ul>",
    signatures: [
      {
        label: "drawLine(pattern, chars)",
        parameters: [
          {
            label: "Pattern pattern",
            documentation: "<p>the pattern to use</p>",
          },
          {
            label: "number chars",
            documentation: "<p>max number of characters (approximately)</p>",
          },
        ],
      },
    ],
  },
  {
    name: "euclid",
    detail: "Pattern.euclid/temporal",
    documentation:
      "<p>Changes the structure of the pattern to form an Euclidean rhythm.\nEuclidean rhythms are rhythms obtained using the greatest common\ndivisor of two numbers.  They were described in 2004 by Godfried\nToussaint, a Canadian computer scientist.  Euclidean rhythms are\nreally useful for computer/algorithmic music because they can\ndescribe a large number of rhythms with a couple of numbers.</p>\n<p>A negative number of pulses inverts the pattern\nso pulses happen in the gaps of the normal euclidean rhythm.</p>\n<p>A negative number of steps changes it into <code>euclidLegato</code>.</p>",
    signatures: [
      {
        label: "euclid(pulses, steps)",
        parameters: [
          {
            label: "number pulses",
            documentation: "<p>the number of onsets/beats</p>",
          },
          {
            label: "number steps",
            documentation: "<p>the number of steps to fill</p>",
          },
        ],
      },
    ],
  },
  {
    name: "euclidRot",
    detail: "Pattern.euclidRot/temporal",
    documentation:
      "<p>Like <code>euclid</code>, but has an additional parameter for 'rotating' the resulting sequence.</p>",
    signatures: [
      {
        label: "euclidRot(pulses, steps, rotation)",
        parameters: [
          {
            label: "number pulses",
            documentation: "<p>the number of onsets/beats</p>",
          },
          {
            label: "number steps",
            documentation: "<p>the number of steps to fill</p>",
          },
          {
            label: "number rotation",
            documentation: "<p>offset in steps</p>",
          },
        ],
      },
    ],
  },
  {
    name: "_euclidRot",
    detail: "_euclidRot",
    documentation: "",
    signatures: [
      {
        label: "_euclidRot()",
        parameters: [],
      },
    ],
  },
  {
    name: "euclidLegato",
    detail: "Pattern.euclidLegato/temporal",
    documentation:
      "<p>Similar to <code>euclid</code>, but each pulse is held until the next pulse,\nso there will be no gaps.</p>\n<p>A negative number of steps changes it into <code>euclid</code>.</p>",
    signatures: [
      {
        label: "euclidLegato(pulses, steps, rotation, pat)",
        parameters: [
          {
            label: "number pulses",
            documentation: "<p>the number of onsets/beats</p>",
          },
          {
            label: "number steps",
            documentation: "<p>the number of steps to fill</p>",
          },
          {
            label: "undefined rotation",
            documentation: "<p>offset in steps</p>",
          },
          {
            label: "undefined pat",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "euclidLegatoRot",
    detail: "Pattern.euclidLegatoRot/temporal",
    documentation:
      "<p>Similar to <code>euclid</code>, but each pulse is held until the next pulse,\nso there will be no gaps, and has an additional parameter for 'rotating'\nthe resulting sequence.</p>\n<p>A negative number of steps changes it into <code>euclidRot</code>.</p>",
    signatures: [
      {
        label: "euclidLegatoRot(pulses, steps, rotation)",
        parameters: [
          {
            label: "number pulses",
            documentation: "<p>the number of onsets/beats</p>",
          },
          {
            label: "number steps",
            documentation: "<p>the number of steps to fill</p>",
          },
          {
            label: "number rotation",
            documentation: "<p>offset in steps</p>",
          },
        ],
      },
    ],
  },
  {
    name: "euclidish",
    detail: "Pattern.euclidish/temporal",
    documentation:
      "<p>A 'euclid' variant with an additional parameter that morphs the resulting\nrhythm from 0 (no morphing) to 1 (completely 'even'). For example\n<code>sound(&quot;bd&quot;).euclidish(3,8,0)</code> would be the same as\n<code>sound(&quot;bd&quot;).euclid(3,8)</code>, and <code>sound(&quot;bd&quot;).euclidish(3,8,1)</code> would be the\nsame as <code>sound(&quot;bd bd bd&quot;)</code>. <code>sound(&quot;bd&quot;).euclidish(3,8,0.5)</code> would have a\ngroove somewhere between.\nInspired by the work of Malcom Braff.</p>",
    signatures: [
      {
        label: "euclidish(pulses, steps, groove)",
        parameters: [
          {
            label: "number pulses",
            documentation: "<p>the number of onsets</p>",
          },
          {
            label: "number steps",
            documentation: "<p>the number of steps to fill</p>",
          },
          {
            label: "number groove",
            documentation:
              "<p>exists between the extremes of 0 (straight euclidian) and 1 (straight pulse)</p>",
          },
        ],
      },
    ],
  },
  {
    name: "Pattern",
    detail: "Pattern/noautocomplete",
    documentation:
      "<p>Create a pattern. As an end user, you will most likely not create a Pattern directly.</p>",
    signatures: [
      {
        label: "Pattern(query)",
        parameters: [
          {
            label: "function query",
            documentation:
              "<p>The function that maps a <code>State</code> to an array of <code>Hap</code>.</p>",
          },
        ],
      },
    ],
  },
  {
    name: "withValue",
    detail: "Pattern#withValue/functional",
    documentation:
      "<p>Returns a new pattern, with the function applied to the value of\neach hap. It has the alias <code>fmap</code>.</p>",
    signatures: [
      {
        label: "withValue(func)",
        parameters: [
          {
            label: "function func",
            documentation: "<p>to to apply to the value</p>",
          },
        ],
      },
    ],
  },
  {
    name: "fmap",
    detail: "Pattern#fmap/noautocomplete",
    documentation: "<p>see <code>withValue</code></p>",
    signatures: [
      {
        label: "fmap()",
        parameters: [],
      },
    ],
  },
  {
    name: "appWhole",
    detail: "Pattern#appWhole/functional,noautocomplete",
    documentation:
      "<p>Assumes 'this' is a pattern of functions, and given a function to\nresolve wholes, applies a given pattern of values to that\npattern of functions.</p>",
    signatures: [
      {
        label: "appWhole(whole_func, func)",
        parameters: [
          {
            label: "function whole_func",
            documentation: "",
          },
          {
            label: "function func",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "appBoth",
    detail: "Pattern#appBoth/functional,noautocomplete",
    documentation:
      "<p>When this method is called on a pattern of functions, it matches its haps\nwith those in the given pattern of values.  A new pattern is returned, with\neach matching value applied to the corresponding function.</p>\n<p>In this <code>_appBoth</code> variant, where timespans of the function and value haps\nare not the same but do intersect, the resulting hap has a timespan of the\nintersection. This applies to both the part and the whole timespan.</p>",
    signatures: [
      {
        label: "appBoth(pat_val)",
        parameters: [
          {
            label: "Pattern pat_val",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "appLeft",
    detail: "Pattern#appLeft/functional,noautocomplete",
    documentation:
      "<p>As with <code>appBoth</code>, but the <code>whole</code> timespan is not the intersection,\nbut the timespan from the function of patterns that this method is called\non. In practice, this means that the pattern structure, including onsets,\nare preserved from the pattern of functions (often referred to as the left\nhand or inner pattern).</p>",
    signatures: [
      {
        label: "appLeft(pat_val)",
        parameters: [
          {
            label: "Pattern pat_val",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "appRight",
    detail: "Pattern#appRight/functional,noautocomplete",
    documentation:
      "<p>As with <code>appLeft</code>, but <code>whole</code> timespans are instead taken from the\npattern of values, i.e. structure is preserved from the right hand/outer\npattern.</p>",
    signatures: [
      {
        label: "appRight(pat_val)",
        parameters: [
          {
            label: "Pattern pat_val",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "queryArc",
    detail: "Pattern#queryArc/internals,noautocomplete",
    documentation: "<p>Query haps inside the given time span.</p>",
    signatures: [
      {
        label: "queryArc(begin, end)",
        parameters: [
          {
            label: "Fraction begin",
            documentation: "<p>from time</p>",
          },
          {
            label: "Fraction end",
            documentation: "<p>to time</p>",
          },
        ],
      },
    ],
  },
  {
    name: "splitQueries",
    detail: "Pattern#splitQueries/internals,noautocomplete",
    documentation:
      "<p>Returns a new pattern, with queries split at cycle boundaries. This makes\nsome calculations easier to express, as all haps are then constrained to\nhappen within a cycle.</p>",
    signatures: [
      {
        label: "splitQueries()",
        parameters: [],
      },
    ],
  },
  {
    name: "withQuerySpan",
    detail: "Pattern#withQuerySpan/internals,noautocomplete",
    documentation:
      "<p>Returns a new pattern, where the given function is applied to the query\ntimespan before passing it to the original pattern.</p>",
    signatures: [
      {
        label: "withQuerySpan(func)",
        parameters: [
          {
            label: "function func",
            documentation: "<p>the function to apply</p>",
          },
        ],
      },
    ],
  },
  {
    name: "withQueryTime",
    detail: "Pattern#withQueryTime/internals,noautocomplete",
    documentation:
      "<p>As with <code>withQuerySpan</code>, but the function is applied to both the\nbegin and end time of the query timespan.</p>",
    signatures: [
      {
        label: "withQueryTime(func)",
        parameters: [
          {
            label: "function func",
            documentation: "<p>the function to apply</p>",
          },
        ],
      },
    ],
  },
  {
    name: "withHapSpan",
    detail: "Pattern#withHapSpan/internals,noautocomplete",
    documentation:
      "<p>Similar to <code>withQuerySpan</code>, but the function is applied to the timespans\nof all haps returned by pattern queries (both <code>part</code> timespans, and where\npresent, <code>whole</code> timespans).</p>",
    signatures: [
      {
        label: "withHapSpan(func)",
        parameters: [
          {
            label: "function func",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "withHapTime",
    detail: "Pattern#withHapTime/internals,noautocomplete",
    documentation:
      "<p>As with <code>withHapSpan</code>, but the function is applied to both the\nbegin and end time of the hap timespans.</p>",
    signatures: [
      {
        label: "withHapTime(func)",
        parameters: [
          {
            label: "function func",
            documentation: "<p>the function to apply</p>",
          },
        ],
      },
    ],
  },
  {
    name: "withHaps",
    detail: "Pattern#withHaps/internals,noautocomplete",
    documentation:
      "<p>Returns a new pattern with the given function applied to the list of haps returned by every query.</p>\n<p>As an end user, you will most likely not need to use this; look at <code>withContext</code>, <code>withHapSpan</code>, etc. instead.</p>",
    signatures: [
      {
        label: "withHaps(func)",
        parameters: [
          {
            label: "function func",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "withHap",
    detail: "Pattern#withHap/internals,noautocomplete",
    documentation:
      "<p>As with <code>withHaps</code>, but applies the function to every hap, rather than every list of haps.</p>\n<p>As an end user, you will most likely not need to use this; look at <code>withContext</code>, <code>withHapSpan</code>, etc. instead.</p>",
    signatures: [
      {
        label: "withHap(func)",
        parameters: [
          {
            label: "function func",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "setContext",
    detail: "Pattern#setContext/internals,noautocomplete",
    documentation:
      "<p>Returns a new pattern with the context field set to every hap set to the given value.</p>",
    signatures: [
      {
        label: "setContext(context)",
        parameters: [
          {
            label: "* context",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "withContext",
    detail: "Pattern#withContext/internals,noautocomplete",
    documentation:
      "<p>Returns a new pattern with the given function applied to the context field of every hap.</p>",
    signatures: [
      {
        label: "withContext(func)",
        parameters: [
          {
            label: "function func",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "stripContext",
    detail: "Pattern#stripContext/internals,noautocomplete",
    documentation:
      "<p>Returns a new pattern with the context field of every hap set to an empty object.</p>",
    signatures: [
      {
        label: "stripContext()",
        parameters: [],
      },
    ],
  },
  {
    name: "withLoc",
    detail: "Pattern#withLoc/internals,noautocomplete",
    documentation:
      "<p>Returns a new pattern with the given location information added to the\ncontext of every hap.</p>",
    signatures: [
      {
        label: "withLoc(start, end)",
        parameters: [
          {
            label: "Number start",
            documentation: "<p>start offset</p>",
          },
          {
            label: "Number end",
            documentation: "<p>end offset</p>",
          },
        ],
      },
    ],
  },
  {
    name: "filterHaps",
    detail: "Pattern#filterHaps/internals",
    documentation:
      "<p>Returns a new Pattern, which only returns haps that meet the given test.</p>",
    signatures: [
      {
        label: "filterHaps(hap_test)",
        parameters: [
          {
            label: "function hap_test",
            documentation:
              "<p>a function which returns false for haps to be removed from the pattern</p>",
          },
        ],
      },
    ],
  },
  {
    name: "filterValues",
    detail: "Pattern#filterValues/internals",
    documentation:
      "<p>As with <code>filterHaps</code>, but the function is applied to values\ninside haps.</p>",
    signatures: [
      {
        label: "filterValues(value_test)",
        parameters: [
          {
            label: "function value_test",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "removeUndefineds",
    detail: "Pattern#removeUndefineds/internals,noautocomplete",
    documentation:
      "<p>Returns a new pattern, with haps containing undefined values removed from\nquery results.</p>",
    signatures: [
      {
        label: "removeUndefineds()",
        parameters: [],
      },
    ],
  },
  {
    name: "onsetsOnly",
    detail: "Pattern#onsetsOnly/internals,noautocomplete",
    documentation:
      "<p>Returns a new pattern, with all haps without onsets filtered out. A hap\nwith an onset is one with a <code>whole</code> timespan that begins at the same time\nas its <code>part</code> timespan.</p>",
    signatures: [
      {
        label: "onsetsOnly()",
        parameters: [],
      },
    ],
  },
  {
    name: "discreteOnly",
    detail: "Pattern#discreteOnly/internals,noautocomplete",
    documentation:
      "<p>Returns a new pattern, with 'continuous' haps (those without 'whole'\ntimespans) removed from query results.</p>",
    signatures: [
      {
        label: "discreteOnly()",
        parameters: [],
      },
    ],
  },
  {
    name: "defragmentHaps",
    detail: "Pattern#defragmentHaps/internals,noautocomplete",
    documentation:
      "<p>Combines adjacent haps with the same value and whole.  Only\nintended for use in tests.</p>",
    signatures: [
      {
        label: "defragmentHaps()",
        parameters: [],
      },
    ],
  },
  {
    name: "firstCycle",
    detail: "Pattern#firstCycle/internals,noautocomplete",
    documentation:
      "<p>Queries the pattern for the first cycle, returning Haps. Mainly of use when\ndebugging a pattern.</p>",
    signatures: [
      {
        label: "firstCycle(with_context)",
        parameters: [
          {
            label: "Boolean with_context",
            documentation:
              "<p>set to true, otherwise the context field\nwill be stripped from the resulting haps.</p>",
          },
        ],
      },
    ],
  },
  {
    name: "firstCycleValues",
    detail: "Pattern#firstCycleValues/internals,noautocomplete",
    documentation:
      "<p>Accessor for a list of values returned by querying the first cycle.</p>",
    signatures: [
      {
        label: "firstCycleValues()",
        parameters: [],
      },
    ],
  },
  {
    name: "showFirstCycle",
    detail: "Pattern#showFirstCycle/internals,noautocomplete",
    documentation:
      "<p>More human-readable version of the <code>firstCycleValues</code> accessor.</p>",
    signatures: [
      {
        label: "showFirstCycle()",
        parameters: [],
      },
    ],
  },
  {
    name: "sortHapsByPart",
    detail: "Pattern#sortHapsByPart/internals,noautocomplete",
    documentation:
      "<p>Returns a new pattern, which returns haps sorted in temporal order. Mainly\nof use when comparing two patterns for equality, in tests.</p>",
    signatures: [
      {
        label: "sortHapsByPart()",
        parameters: [],
      },
    ],
  },
  {
    name: "asNumber",
    detail: "Pattern#asNumber/internals",
    documentation:
      "<p>Returns a new pattern with all values parsed as numerals.</p>",
    signatures: [
      {
        label: "asNumber()",
        parameters: [],
      },
    ],
  },
  {
    name: "layer",
    detail: "Pattern.layer/combiners",
    documentation:
      "<p>Layers the result of the given function(s). Like <code>superimpose</code>, but without the original pattern:</p>",
    signatures: [
      {
        label: "layer()",
        parameters: [],
      },
    ],
  },
  {
    name: "superimpose",
    detail: "Pattern.superimpose/combiners",
    documentation:
      "<p>Superimposes the result of the given function(s) on top of the original pattern:</p>",
    signatures: [
      {
        label: "superimpose()",
        parameters: [],
      },
    ],
  },
  {
    name: "onSchedule",
    detail: "Pattern.onSchedule",
    documentation:
      "<p>Attaches a function that is called for each hap onset.</p>",
    signatures: [
      {
        label: "onSchedule()",
        parameters: [],
      },
    ],
  },
  {
    name: "log",
    detail: "Pattern.log/visualization",
    documentation:
      "<p>Writes the content of the current event to the console (visible in the side menu).</p>",
    signatures: [
      {
        label: "log()",
        parameters: [],
      },
    ],
  },
  {
    name: "logValues",
    detail: "Pattern.logValues/visualization",
    documentation:
      "<p>A simplified version of <code>log</code> which writes all &quot;values&quot; (various configurable parameters)\nwithin the event to the console (visible in the side menu).</p>",
    signatures: [
      {
        label: "logValues()",
        parameters: [],
      },
    ],
  },
  {
    name: "into",
    detail: "Pattern.into/temporal",
    documentation:
      "<p>Breaks a pattern into pieces according to the structure of a given pattern.\nTrue values in the given pattern cause the corresponding subcycle of the\nsource pattern to be looped, and for an (optional) given function to be\napplied. False values result in the corresponding part of the source pattern\nto be played unchanged.</p>",
    signatures: [
      {
        label: "into()",
        parameters: [],
      },
    ],
  },
  {
    name: "arpWith",
    detail: "arpWith/temporal",
    documentation: "<p>Selects indices in in stacked notes.</p>",
    signatures: [
      {
        label: "arpWith()",
        parameters: [],
      },
    ],
  },
  {
    name: "arp",
    detail: "arp/temporal",
    documentation: "<p>Selects indices in in stacked notes.</p>",
    signatures: [
      {
        label: "arp()",
        parameters: [],
      },
    ],
  },
  {
    name: "set",
    detail: "Pattern.set/internals,combiners",
    documentation:
      "<p>When called on a pattern <code>a</code>, with a input pattern <code>b</code> (<code>a.set(b)</code>),\ncombines <code>a</code> and <code>b</code> such that anything defined in <code>b</code>\nand anything defined in <code>a</code> that is <em>not</em> defined in <code>b</code>\nwill be in the resulting pattern.</p>\n<p>The structure is maintained from <code>a</code>,\nbecause the default pattern alignment is <code>in</code>,\nsee the section on <code>Pattern Alignment</code>\nin the technical manual in the docs</p>\n<p>This is the inverse of <code>keep</code></p>\n<p>See examples below</p>",
    signatures: [
      {
        label: "set(pat)",
        parameters: [
          {
            label: "Pattern pat",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "keep",
    detail: "Pattern.keep/internals,combiners",
    documentation:
      "<p>When called on a pattern <code>a</code>, with a input pattern <code>b</code> (<code>a.keep(b)</code>),\ncombines <code>a</code> and <code>b</code> such that anything defined in <code>a</code>,\nand anything defined in <code>b</code> that is <em>not</em> defined in <code>a</code>\nwill be in the resulting pattern</p>\n<p>The structure is maintained from <code>a</code>,\nbecause the default pattern alignment is <code>in</code>,\nsee the section on <code>Pattern Alignment</code>\nin the technical manual in the docs</p>\n<p>This is the inverse of <code>set</code></p>\n<p>See examples below</p>",
    signatures: [
      {
        label: "keep(pat)",
        parameters: [
          {
            label: "Pattern pat",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "add",
    detail: "Pattern.add/math",
    documentation:
      "<p>Assumes a pattern of numbers. Adds the given number to each item in the pattern.</p>",
    signatures: [
      {
        label: "add()",
        parameters: [],
      },
    ],
  },
  {
    name: "sub",
    detail: "Pattern.sub/math",
    documentation: "<p>Like add, but the given numbers are subtracted.</p>",
    signatures: [
      {
        label: "sub()",
        parameters: [],
      },
    ],
  },
  {
    name: "mul",
    detail: "Pattern.mul/math",
    documentation: "<p>Multiplies each number by the given factor.</p>",
    signatures: [
      {
        label: "mul()",
        parameters: [],
      },
    ],
  },
  {
    name: "div",
    detail: "Pattern.div/math",
    documentation: "<p>Divides each number by the given factor.</p>",
    signatures: [
      {
        label: "div()",
        parameters: [],
      },
    ],
  },
  {
    name: "mod",
    detail: "Pattern.mod/math",
    documentation:
      "<p>Divides each number by the given factor and returns the remainder</p>",
    signatures: [
      {
        label: "mod()",
        parameters: [],
      },
    ],
  },
  {
    name: "pow",
    detail: "Pattern.pow/math",
    documentation: "<p>Raises each number to the power of the given factor</p>",
    signatures: [
      {
        label: "pow()",
        parameters: [],
      },
    ],
  },
  {
    name: "band",
    detail: "Pattern.band/math",
    documentation:
      "<p>Performs a bitwise <code>and</code> on each number and the given factor</p>",
    signatures: [
      {
        label: "band()",
        parameters: [],
      },
    ],
  },
  {
    name: "bor",
    detail: "Pattern.bor/math",
    documentation:
      "<p>Performs a bitwise <code>or</code> on each number and the given factor</p>",
    signatures: [
      {
        label: "bor()",
        parameters: [],
      },
    ],
  },
  {
    name: "bxor",
    detail: "Pattern.bxor/math",
    documentation:
      "<p>Performs a bitwise <code>xor</code> on each number and the given factor</p>",
    signatures: [
      {
        label: "bxor()",
        parameters: [],
      },
    ],
  },
  {
    name: "blshift",
    detail: "Pattern.blshift/math",
    documentation:
      "<p>Performs a bitwise <code>left shift</code> on each number by the given factor</p>",
    signatures: [
      {
        label: "blshift()",
        parameters: [],
      },
    ],
  },
  {
    name: "brshift",
    detail: "Pattern.brshift/math",
    documentation:
      "<p>Performs a bitwise <code>right shift</code> on each number by the given factor</p>",
    signatures: [
      {
        label: "brshift()",
        parameters: [],
      },
    ],
  },
  {
    name: "lt",
    detail: "Pattern.lt/math",
    documentation: "<p>performs a &lt; b</p>",
    signatures: [
      {
        label: "lt(a, b)",
        parameters: [
          {
            label: "any a",
            documentation: "",
          },
          {
            label: "any b",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "gt",
    detail: "Pattern.gt/math",
    documentation: "<p>performs a &gt; b</p>",
    signatures: [
      {
        label: "gt(a, b)",
        parameters: [
          {
            label: "any a",
            documentation: "",
          },
          {
            label: "any b",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "lte",
    detail: "Pattern.lte/math",
    documentation: "<p>performs a &lt;= b</p>",
    signatures: [
      {
        label: "lte(a, b)",
        parameters: [
          {
            label: "any a",
            documentation: "",
          },
          {
            label: "any b",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "gte",
    detail: "Pattern.gte/math",
    documentation: "<p>performs a &gt;= b</p>",
    signatures: [
      {
        label: "gte(a, b)",
        parameters: [
          {
            label: "any a",
            documentation: "",
          },
          {
            label: "any b",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "eq",
    detail: "Pattern.eq/math",
    documentation: "<p>performs a == b</p>",
    signatures: [
      {
        label: "eq(a, b)",
        parameters: [
          {
            label: "any a",
            documentation: "",
          },
          {
            label: "any b",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "eqt",
    detail: "Pattern.eqt/math",
    documentation: "<p>performs a === b (strictly equal)</p>",
    signatures: [
      {
        label: "eqt(a, b)",
        parameters: [
          {
            label: "any a",
            documentation: "",
          },
          {
            label: "any b",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "ne",
    detail: "Pattern.ne/math",
    documentation: "<p>performs a != b</p>",
    signatures: [
      {
        label: "ne(a, b)",
        parameters: [
          {
            label: "any a",
            documentation: "",
          },
          {
            label: "any b",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "net",
    detail: "Pattern.net/math",
    documentation: "<p>performs a !== b (strictly not equal)</p>",
    signatures: [
      {
        label: "net(a, b)",
        parameters: [
          {
            label: "any a",
            documentation: "",
          },
          {
            label: "any b",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "and",
    detail: "Pattern.and/math",
    documentation: "<p>performs a &amp;&amp; b</p>",
    signatures: [
      {
        label: "and(a, b)",
        parameters: [
          {
            label: "any a",
            documentation: "",
          },
          {
            label: "any b",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "or",
    detail: "Pattern.or/math",
    documentation: "<p>performs a || b</p>",
    signatures: [
      {
        label: "or(a, b)",
        parameters: [
          {
            label: "any a",
            documentation: "",
          },
          {
            label: "any b",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "struct",
    detail: "Pattern#struct/temporal",
    documentation: "<p>Applies the given structure to the pattern:</p>",
    signatures: [
      {
        label: "struct()",
        parameters: [],
      },
    ],
  },
  {
    name: "mask",
    detail: "Pattern#mask/temporal",
    documentation: "<p>Returns silence when mask is 0 or &quot;~&quot;</p>",
    signatures: [
      {
        label: "mask()",
        parameters: [],
      },
    ],
  },
  {
    name: "reset",
    detail: "Pattern#reset/temporal",
    documentation:
      "<p>Resets the pattern to the start of the cycle for each onset of the reset pattern.</p>",
    signatures: [
      {
        label: "reset()",
        parameters: [],
      },
    ],
  },
  {
    name: "restart",
    detail: "Pattern#restart/temporal",
    documentation:
      "<p>Restarts the pattern for each onset of the restart pattern.\nWhile reset will only reset the current cycle, restart will start from cycle 0.</p>",
    signatures: [
      {
        label: "restart()",
        parameters: [],
      },
    ],
  },
  {
    name: "setDefaultJoin",
    detail: "setDefaultJoin/combiners",
    documentation:
      "<p>Sets the default method of combining events from two patterns (aka <a href=\"https://strudel.cc/technical-manual/alignment/\">alignment</a>) in Strudel.\nThe default method is 'in', meaning that patterns to the left will (typically) dictate the event timings when combined with patterns to the right.\nBy changing alignment to 'out', the opposite will happen. With 'mix', they will combine their event timings.</p>\n<p>Note that we say the <em>default</em> method, because alignments can also be set explicitly with calls like\n'add.mix', 'set.squeeze', etc.</p>",
    signatures: [
      {
        label: "setDefaultJoin(method)",
        parameters: [
          {
            label: "string method",
            documentation:
              "<p>Default join method to use. Options: 'in', 'out', 'mix', 'squeeze', 'squeezeout', 'reset', 'restart', 'poly'</p>",
          },
        ],
      },
    ],
  },
  {
    name: "gap",
    detail: "gap/generators",
    documentation:
      "<p>Does absolutely nothing, but with a given metrical 'steps'</p>",
    signatures: [
      {
        label: "gap(steps)",
        parameters: [
          {
            label: "number steps",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "silence",
    detail: "silence/generators",
    documentation: "<p>Does absolutely nothing..</p>",
    signatures: [
      {
        label: "silence()",
        parameters: [],
      },
    ],
  },
  {
    name: "pure",
    detail: "pure/generators,noautocomplete",
    documentation: "<p>A discrete value that repeats once per cycle.</p>",
    signatures: [
      {
        label: "pure()",
        parameters: [],
      },
    ],
  },
  {
    name: "sequenceP",
    detail: "sequenceP/temporal",
    documentation:
      "<p>Takes a list of patterns, and returns a pattern of lists.</p>",
    signatures: [
      {
        label: "sequenceP()",
        parameters: [],
      },
    ],
  },
  {
    name: "stack",
    detail: "stack/temporal",
    documentation:
      "<p>The given items are played at the same time at the same length.</p>",
    signatures: [
      {
        label: "stack()",
        parameters: [],
      },
    ],
  },
  {
    name: "stackLeft",
    detail: "stackLeft/temporal,stepwise,combiners",
    documentation:
      "<p>The input patterns are aligned to the left, with silence padded to the shorter pattern(s) in the final steps if there's a stepcount disparity. See also <code>stackRight</code> and <code>stackCenter/stackCentre</code></p>",
    signatures: [
      {
        label: "stackLeft()",
        parameters: [],
      },
    ],
  },
  {
    name: "stackRight",
    detail: "stackRight/temporal,stepwise,combiners",
    documentation:
      "<p>The input patterns are aligned to the right, with silence padded to the shorter pattern(s) in the initial steps if there's a stepcount disparity. See also <code>stackLeft</code> and <code>stackCenter/stackCentre</code></p>",
    signatures: [
      {
        label: "stackRight()",
        parameters: [],
      },
    ],
  },
  {
    name: "stackCenter",
    detail: "stackCenter/temporal,stepwise,combiners",
    documentation:
      "<p>The input patterns are aligned to the right, with silence padded to the shorter pattern(s) in the initial steps if there's a stepcount disparity. See also <code>stackLeft</code> and <code>stackRight</code></p>",
    signatures: [
      {
        label: "stackCenter()",
        parameters: [],
      },
    ],
  },
  {
    name: "stackRepeat",
    detail: "stackRepeat/temporal,stepwise,combiners",
    documentation:
      "<p>Shorthand for <code>pm(patterns).pace(m)</code> where m is the max step count in the input patterns</p>",
    signatures: [
      {
        label: "stackRepeat()",
        parameters: [],
      },
    ],
  },
  {
    name: "slowcat",
    detail: "slowcat/combiners",
    documentation:
      "<p>Concatenation: combines a list of patterns, switching between them successively, one per cycle.</p>",
    signatures: [
      {
        label: "slowcat()",
        parameters: [],
      },
    ],
  },
  {
    name: "slowcatPrime",
    detail: "slowcatPrime/combiners",
    documentation:
      "<p>Concatenation: combines a list of patterns, switching between them successively, one per cycle. Unlike slowcat, this version will skip cycles.</p>",
    signatures: [
      {
        label: "slowcatPrime(items)",
        parameters: [
          {
            label: "any items",
            documentation: "<p>The items to concatenate</p>",
          },
        ],
      },
    ],
  },
  {
    name: "cat",
    detail: "cat/combiners",
    documentation:
      "<p>The given items are con<strong>cat</strong>enated, where each one takes one cycle.</p>",
    signatures: [
      {
        label: "cat(items)",
        parameters: [
          {
            label: "any items",
            documentation: "<p>The items to concatenate</p>",
          },
        ],
      },
    ],
  },
  {
    name: "arrange",
    detail: "arrange/combiners",
    documentation:
      "<p>Allows to arrange multiple patterns together over multiple cycles.\nTakes a variable number of arrays with two elements specifying the number of cycles and the pattern to use.</p>",
    signatures: [
      {
        label: "arrange()",
        parameters: [],
      },
    ],
  },
  {
    name: "seqPLoop",
    detail: "seqPLoop/combiners",
    documentation:
      "<p>Similarly to <code>arrange</code>, allows you to arrange multiple patterns together over multiple cycles.\nUnlike <code>arrange</code>, you specify a start and stop time for each pattern rather than duration, which\nmeans that patterns can overlap.</p>",
    signatures: [
      {
        label: "seqPLoop()",
        parameters: [],
      },
    ],
  },
  {
    name: "sequence",
    detail: "sequence/combiners",
    documentation: "<p>See <code>fastcat</code></p>",
    signatures: [
      {
        label: "sequence()",
        parameters: [],
      },
    ],
  },
  {
    name: "seq",
    detail: "seq/combiners",
    documentation:
      "<p>Like <strong>cat</strong>, but the items are crammed into one cycle.</p>",
    signatures: [
      {
        label: "seq()",
        parameters: [],
      },
    ],
  },
  {
    name: "register",
    detail: "register/functional",
    documentation:
      "<p>Registers a new pattern method. The method is added to the Pattern class + the standalone function is returned from register.</p>",
    signatures: [
      {
        label: "register(name, func, patternify)",
        parameters: [
          {
            label: "string name",
            documentation:
              "<p>name of the function, or an array of names to be used as synonyms</p>",
          },
          {
            label: "function func",
            documentation:
              "<p>function with 1 or more params, where last is the current pattern</p>",
          },
          {
            label: "bool patternify",
            documentation:
              "<p>defaults to true; if set to false, you will have more control over the arguments to <code>func</code> as they will be\nin their raw form and it will be up to you to patternify them and/or query them for values</p>",
          },
        ],
      },
    ],
  },
  {
    name: "round",
    detail: "Pattern.round/math",
    documentation:
      "<p>Assumes a numerical pattern. Returns a new pattern with all values rounded\nto the nearest integer.</p>",
    signatures: [
      {
        label: "round()",
        parameters: [],
      },
    ],
  },
  {
    name: "floor",
    detail: "Pattern.floor/math",
    documentation:
      "<p>Assumes a numerical pattern. Returns a new pattern with all values set to\ntheir mathematical floor. E.g. <code>3.7</code> replaced with to <code>3</code>, and <code>-4.2</code>\nreplaced with <code>-5</code>.</p>",
    signatures: [
      {
        label: "floor()",
        parameters: [],
      },
    ],
  },
  {
    name: "ceil",
    detail: "Pattern.ceil/math",
    documentation:
      "<p>Assumes a numerical pattern. Returns a new pattern with all values set to\ntheir mathematical ceiling. E.g. <code>3.2</code> replaced with <code>4</code>, and <code>-4.2</code>\nreplaced with <code>-4</code>.</p>",
    signatures: [
      {
        label: "ceil()",
        parameters: [],
      },
    ],
  },
  {
    name: "toBipolar",
    detail: "toBipolar/math,noautocomplete",
    documentation:
      "<p>Assumes a numerical pattern, containing unipolar values in the range 0 ..</p>\n<ol>\n<li>Returns a new pattern with values scaled to the bipolar range -1 .. 1</li>\n</ol>",
    signatures: [
      {
        label: "toBipolar()",
        parameters: [],
      },
    ],
  },
  {
    name: "fromBipolar",
    detail: "fromBipolar/math,noautocomplete",
    documentation:
      "<p>Assumes a numerical pattern, containing bipolar values in the range -1 .. 1\nReturns a new pattern with values scaled to the unipolar range 0 .. 1</p>",
    signatures: [
      {
        label: "fromBipolar()",
        parameters: [],
      },
    ],
  },
  {
    name: "range",
    detail: "Pattern.range/math",
    documentation:
      "<p>Assumes a numerical pattern, containing unipolar values in the range 0 .. 1.\nReturns a new pattern with values scaled to the given min/max range.\nMost useful in combination with continuous patterns.</p>",
    signatures: [
      {
        label: "range()",
        parameters: [],
      },
    ],
  },
  {
    name: "rangex",
    detail: "Pattern.rangex/math",
    documentation:
      "<p>Assumes a numerical pattern, containing unipolar values in the range 0 .. 1\nReturns a new pattern with values scaled to the given min/max range,\nfollowing an exponential curve.</p>",
    signatures: [
      {
        label: "rangex()",
        parameters: [],
      },
    ],
  },
  {
    name: "range2",
    detail: "Pattern.range2/math",
    documentation:
      "<p>Assumes a numerical pattern, containing bipolar values in the range -1 .. 1\nReturns a new pattern with values scaled to the given min/max range.</p>",
    signatures: [
      {
        label: "range2()",
        parameters: [],
      },
    ],
  },
  {
    name: "ratio",
    detail: "Pattern.ratio/math",
    documentation:
      "<p>Allows dividing numbers via list notation using &quot;:&quot;.\nReturns a new pattern with just numbers.</p>",
    signatures: [
      {
        label: "ratio()",
        parameters: [],
      },
    ],
  },
  {
    name: "compress",
    detail: "compress/temporal",
    documentation:
      "<p>Compress each cycle into the given timespan, leaving a gap</p>",
    signatures: [
      {
        label: "compress()",
        parameters: [],
      },
    ],
  },
  {
    name: "fastGap",
    detail: "fastGap/temporal",
    documentation:
      "<p>speeds up a pattern like fast, but rather than it playing multiple times as fast would it instead leaves a gap in the remaining space of the cycle. For example, the following will play the sound pattern &quot;bd sn&quot; only once but compressed into the first half of the cycle, i.e. twice as fast.</p>",
    signatures: [
      {
        label: "fastGap()",
        parameters: [],
      },
    ],
  },
  {
    name: "focus",
    detail: "focus/temporal",
    documentation:
      "<p>Similar to <code>compress</code>, but doesn't leave gaps, and the 'focus' can be bigger than a cycle</p>",
    signatures: [
      {
        label: "focus()",
        parameters: [],
      },
    ],
  },
  {
    name: "ply",
    detail: "ply/temporal",
    documentation:
      "<p>The ply function repeats each event the given number of times.</p>",
    signatures: [
      {
        label: "ply()",
        parameters: [],
      },
    ],
  },
  {
    name: "fast",
    detail: "Pattern.fast/temporal",
    documentation:
      "<p>Speed up a pattern by the given factor. Used by &quot;*&quot; in mini notation.</p>",
    signatures: [
      {
        label: "fast(factor)",
        parameters: [
          {
            label: "number factor",
            documentation: "<p>speed up factor</p>",
          },
        ],
      },
    ],
  },
  {
    name: "hurry",
    detail: "hurry/temporal",
    documentation:
      "<p>Both speeds up the pattern (like 'fast') and the sample playback (like 'speed').</p>",
    signatures: [
      {
        label: "hurry()",
        parameters: [],
      },
    ],
  },
  {
    name: "slow",
    detail: "Pattern.slow/temporal",
    documentation:
      "<p>Slow down a pattern over the given number of cycles. Like the &quot;/&quot; operator in mini notation.</p>",
    signatures: [
      {
        label: "slow(factor)",
        parameters: [
          {
            label: "number factor",
            documentation: "<p>slow down factor</p>",
          },
        ],
      },
    ],
  },
  {
    name: "inside",
    detail: "inside/temporal",
    documentation: "<p>Carries out an operation 'inside' a cycle.</p>",
    signatures: [
      {
        label: "inside()",
        parameters: [],
      },
    ],
  },
  {
    name: "outside",
    detail: "outside/temporal",
    documentation: "<p>Carries out an operation 'outside' a cycle.</p>",
    signatures: [
      {
        label: "outside()",
        parameters: [],
      },
    ],
  },
  {
    name: "lastOf",
    detail: "Pattern.lastOf/temporal",
    documentation:
      "<p>Applies the given function every n cycles, starting from the last cycle.</p>",
    signatures: [
      {
        label: "lastOf(n, func)",
        parameters: [
          {
            label: "number n",
            documentation: "<p>how many cycles</p>",
          },
          {
            label: "function func",
            documentation: "<p>function to apply</p>",
          },
        ],
      },
    ],
  },
  {
    name: "firstOf",
    detail: "Pattern.firstOf/temporal",
    documentation:
      "<p>Applies the given function every n cycles, starting from the first cycle.</p>",
    signatures: [
      {
        label: "firstOf(n, func)",
        parameters: [
          {
            label: "number n",
            documentation: "<p>how many cycles</p>",
          },
          {
            label: "function func",
            documentation: "<p>function to apply</p>",
          },
        ],
      },
    ],
  },
  {
    name: "every",
    detail: "Pattern.every/temporal",
    documentation: "<p>An alias for <code>firstOf</code></p>",
    signatures: [
      {
        label: "every(n, func)",
        parameters: [
          {
            label: "number n",
            documentation: "<p>how many cycles</p>",
          },
          {
            label: "function func",
            documentation: "<p>function to apply</p>",
          },
        ],
      },
    ],
  },
  {
    name: "apply",
    detail: "apply/combiners",
    documentation:
      "<p>Applies the given function to the pattern. Like layer, but with a single function:</p>",
    signatures: [
      {
        label: "apply()",
        parameters: [],
      },
    ],
  },
  {
    name: "cpm",
    detail: "cpm/temporal",
    documentation: "<p>Plays the pattern at the given cycles per minute.</p>",
    signatures: [
      {
        label: "cpm()",
        parameters: [],
      },
    ],
  },
  {
    name: "early",
    detail: "Pattern.early/temporal",
    documentation:
      "<p>Nudge a pattern to start earlier in time. Equivalent of Tidal's &lt;~ operator</p>",
    signatures: [
      {
        label: "early(cycles)",
        parameters: [
          {
            label: "number cycles",
            documentation: "<p>number of cycles to nudge left</p>",
          },
        ],
      },
    ],
  },
  {
    name: "late",
    detail: "Pattern.late/temporal",
    documentation:
      "<p>Nudge a pattern to start later in time. Equivalent of Tidal's ~&gt; operator</p>",
    signatures: [
      {
        label: "late(cycles)",
        parameters: [
          {
            label: "number cycles",
            documentation: "<p>number of cycles to nudge right</p>",
          },
        ],
      },
    ],
  },
  {
    name: "zoom",
    detail: "zoom/temporal",
    documentation:
      "<p>Plays a portion of a pattern, specified by the beginning and end of a time span. The new resulting pattern is played over the time period of the original pattern:</p>",
    signatures: [
      {
        label: "zoom()",
        parameters: [],
      },
    ],
  },
  {
    name: "bite",
    detail: "bite/temporal",
    documentation:
      "<p>Splits a pattern into the given number of slices, and plays them according to a pattern of slice numbers.\nSimilar to <code>slice</code>, but slices up patterns rather than sound samples.</p>",
    signatures: [
      {
        label: "bite(number, slices)",
        parameters: [
          {
            label: "number number",
            documentation: "<p>of slices</p>",
          },
          {
            label: "number slices",
            documentation: "<p>to play</p>",
          },
        ],
      },
    ],
  },
  {
    name: "isobite",
    detail: "Pattern.isobite/temporal",
    documentation:
      "<p>Similar to <code>struct</code>, but every hap in the structure pattern plays the next\ncycle of the main pattern.\nWith a different number of cycles in the main pattern and haps in the\nstructure pattern, this creates an isorhythm.</p>\n<p>Note: This function works on the assumption that the structure pattern\nrepeats every cycle. If the structure pattern only repeats after multiple\ncycles, it may skip or repeat certain parts of the melody.</p>",
    signatures: [
      {
        label: "isobite(structure)",
        parameters: [
          {
            label: "Pattern structure",
            documentation: "<p>structure of the pattern</p>",
          },
        ],
      },
    ],
  },
  {
    name: "linger",
    detail: "linger/temporal",
    documentation:
      "<p>Selects the given fraction of the pattern and repeats that part to fill the remainder of the cycle.</p>",
    signatures: [
      {
        label: "linger(fraction)",
        parameters: [
          {
            label: "number fraction",
            documentation: "<p>fraction to select</p>",
          },
        ],
      },
    ],
  },
  {
    name: "segment",
    detail: "segment/temporal",
    documentation:
      "<p>Samples the pattern at a rate of n events per cycle. Useful for turning a continuous pattern into a discrete one.</p>",
    signatures: [
      {
        label: "segment(segments)",
        parameters: [
          {
            label: "number segments",
            documentation: "<p>number of segments per cycle</p>",
          },
        ],
      },
    ],
  },
  {
    name: "swingBy",
    detail: "swingBy/temporal",
    documentation:
      "<p>The function <code>swingBy x n</code> breaks each cycle into <code>n</code> slices, and then delays events in the second half of each slice by the amount <code>x</code>, which is relative to the size of the (half) slice. So if <code>x</code> is 0 it does nothing, <code>0.5</code> delays for half the note duration, and 1 will wrap around to doing nothing again. The end result is a shuffle or swing-like rhythm</p>",
    signatures: [
      {
        label: "swingBy(subdivision, offset)",
        parameters: [
          {
            label: "number subdivision",
            documentation: "",
          },
          {
            label: "number offset",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "swing",
    detail: "swing/temporal",
    documentation: "<p>Shorthand for swingBy with 1/3:</p>",
    signatures: [
      {
        label: "swing(subdivision)",
        parameters: [
          {
            label: "number subdivision",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "invert",
    detail: "invert/temporal",
    documentation: "<p>Swaps 1s and 0s in a binary pattern.</p>",
    signatures: [
      {
        label: "invert()",
        parameters: [],
      },
    ],
  },
  {
    name: "when",
    detail: "Pattern.when/temporal",
    documentation:
      "<p>Applies the given function whenever the given pattern is in a true state.</p>",
    signatures: [
      {
        label: "when(binary_pat, func)",
        parameters: [
          {
            label: "Pattern binary_pat",
            documentation: "",
          },
          {
            label: "function func",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "off",
    detail: "Pattern.off/temporal",
    documentation:
      "<p>Superimposes the function result on top of the original pattern, delayed by the given time.</p>",
    signatures: [
      {
        label: "off(time, func)",
        parameters: [
          {
            label: "Pattern time",
            documentation: "<p>offset time</p>",
          },
          {
            label: "function func",
            documentation: "<p>function to apply</p>",
          },
        ],
      },
    ],
  },
  {
    name: "brak",
    detail: "Pattern.brak/temporal",
    documentation:
      "<p>Returns a new pattern where every other cycle is played once, twice as\nfast, and offset in time by one quarter of a cycle. Creates a kind of\nbreakbeat feel.</p>",
    signatures: [
      {
        label: "brak()",
        parameters: [],
      },
    ],
  },
  {
    name: "rev",
    detail: "Pattern.rev/temporal",
    documentation:
      "<p>Reverse all cycles in a pattern. See also <code>revv</code> for reversing a whole pattern.</p>",
    signatures: [
      {
        label: "rev()",
        parameters: [],
      },
    ],
  },
  {
    name: "revv",
    detail: "Pattern.revv/temporal",
    documentation:
      "<p>Reverse a whole pattern. See also <code>rev</code> for reversing each cycle.</p>",
    signatures: [
      {
        label: "revv()",
        parameters: [],
      },
    ],
  },
  {
    name: "pressBy",
    detail: "pressBy/temporal",
    documentation:
      "<p>Like press, but allows you to specify the amount by which each\nevent is shifted. pressBy(0.5) is the same as press, while\npressBy(1/3) shifts each event by a third of its timespan.</p>",
    signatures: [
      {
        label: "pressBy()",
        parameters: [],
      },
    ],
  },
  {
    name: "press",
    detail: "press/temporal",
    documentation:
      "<p>Syncopates a rhythm, by shifting each event halfway into its timespan.</p>",
    signatures: [
      {
        label: "press()",
        parameters: [],
      },
    ],
  },
  {
    name: "hush",
    detail: "Pattern#hush/temporal",
    documentation: "<p>Silences a pattern.</p>",
    signatures: [
      {
        label: "hush()",
        parameters: [],
      },
    ],
  },
  {
    name: "palindrome",
    detail: "palindrome/temporal",
    documentation:
      "<p>Applies <code>rev</code> to a pattern every other cycle, so that the pattern alternates between forwards and backwards.</p>",
    signatures: [
      {
        label: "palindrome()",
        parameters: [],
      },
    ],
  },
  {
    name: "juxBy",
    detail: "juxBy/temporal",
    documentation:
      "<p>Jux with adjustable stereo width. 0 = mono, 1 = full stereo.</p>",
    signatures: [
      {
        label: "juxBy()",
        parameters: [],
      },
    ],
  },
  {
    name: "juxFlipBy",
    detail: "juxFlipBy",
    documentation: "<p>Like juxBy, except it flips the ears each cycle.</p>",
    signatures: [
      {
        label: "juxFlipBy()",
        parameters: [],
      },
    ],
  },
  {
    name: "jux",
    detail: "jux/temporal,superdough",
    documentation:
      "<p>The jux function creates strange stereo effects, by applying a function to a pattern, but only in the right-hand channel.</p>",
    signatures: [
      {
        label: "jux()",
        parameters: [],
      },
    ],
  },
  {
    name: "juxFlip",
    detail: "juxFlip",
    documentation: "<p>Like jux, but flips the ears each cycle.</p>",
    signatures: [
      {
        label: "juxFlip()",
        parameters: [],
      },
    ],
  },
  {
    name: "echoWith",
    detail: "echoWith/temporal,functional",
    documentation:
      "<p>Superimpose and offset multiple times, applying the given function each time.</p>",
    signatures: [
      {
        label: "echoWith(times, time, func)",
        parameters: [
          {
            label: "number times",
            documentation: "<p>how many times to repeat</p>",
          },
          {
            label: "number time",
            documentation: "<p>cycle offset between iterations</p>",
          },
          {
            label: "function func",
            documentation:
              "<p>function to apply, given the pattern and the iteration index</p>",
          },
        ],
      },
    ],
  },
  {
    name: "echo",
    detail: "Pattern.echo/temporal",
    documentation:
      "<p>Superimpose and offset multiple times, gradually decreasing the velocity</p>",
    signatures: [
      {
        label: "echo(times, time, feedback)",
        parameters: [
          {
            label: "number times",
            documentation: "<p>how many times to repeat</p>",
          },
          {
            label: "number time",
            documentation: "<p>cycle offset between iterations</p>",
          },
          {
            label: "number feedback",
            documentation: "<p>velocity multiplicator for each iteration</p>",
          },
        ],
      },
    ],
  },
  {
    name: "stut",
    detail: "stut/temporal",
    documentation:
      "<p>Deprecated. Like echo, but the last 2 parameters are flipped.</p>",
    signatures: [
      {
        label: "stut(times, feedback, time)",
        parameters: [
          {
            label: "number times",
            documentation: "<p>how many times to repeat</p>",
          },
          {
            label: "number feedback",
            documentation: "<p>velocity multiplicator for each iteration</p>",
          },
          {
            label: "number time",
            documentation: "<p>cycle offset between iterations</p>",
          },
        ],
      },
    ],
  },
  {
    name: "plyWith",
    detail: "plyWith/temporal",
    documentation:
      "<p>The plyWith function repeats each event the given number of times, applying the given function to each event.\\n</p>",
    signatures: [
      {
        label: "plyWith(factor, func)",
        parameters: [
          {
            label: "number factor",
            documentation: "<p>how many times to repeat</p>",
          },
          {
            label: "function func",
            documentation: "<p>function to apply, given the pattern</p>",
          },
        ],
      },
    ],
  },
  {
    name: "plyForEach",
    detail: "plyForEach/temporal",
    documentation:
      "<p>The plyForEach function repeats each event the given number of times, applying the given function to each event.\nThis version of ply uses the iteration index as an argument to the function, similar to echoWith.</p>",
    signatures: [
      {
        label: "plyForEach(factor, func)",
        parameters: [
          {
            label: "number factor",
            documentation: "<p>how many times to repeat</p>",
          },
          {
            label: "function func",
            documentation:
              "<p>function to apply, given the pattern and the iteration index</p>",
          },
        ],
      },
    ],
  },
  {
    name: "iter",
    detail: "Pattern.iter/temporal",
    documentation:
      "<p>Divides a pattern into a given number of subdivisions, plays the subdivisions in order, but increments the starting subdivision each cycle. The pattern wraps to the first subdivision after the last subdivision is played.</p>",
    signatures: [
      {
        label: "iter()",
        parameters: [],
      },
    ],
  },
  {
    name: "iterBack",
    detail: "Pattern.iterBack/temporal",
    documentation:
      "<p>Like <code>iter</code>, but plays the subdivisions in reverse order. Known as iter' in tidalcycles</p>",
    signatures: [
      {
        label: "iterBack()",
        parameters: [],
      },
    ],
  },
  {
    name: "repeatCycles",
    detail: "Pattern.repeatCycles/temporal",
    documentation: "<p>Repeats each cycle the given number of times.</p>",
    signatures: [
      {
        label: "repeatCycles()",
        parameters: [],
      },
    ],
  },
  {
    name: "chunk",
    detail: "Pattern.chunk/temporal,functional",
    documentation:
      "<p>Divides a pattern into a given number of parts, then cycles through those parts in turn, applying the given function to each part in turn (one part per cycle).</p>",
    signatures: [
      {
        label: "chunk()",
        parameters: [],
      },
    ],
  },
  {
    name: "chunkBack",
    detail: "Pattern.chunkBack/temporal",
    documentation:
      "<p>Like <code>chunk</code>, but cycles through the parts in reverse order. Known as chunk' in tidalcycles</p>",
    signatures: [
      {
        label: "chunkBack()",
        parameters: [],
      },
    ],
  },
  {
    name: "fastChunk",
    detail: "Pattern.fastChunk/temporal",
    documentation:
      "<p>Like <code>chunk</code>, but the cycles of the source pattern aren't repeated\nfor each set of chunks.</p>",
    signatures: [
      {
        label: "fastChunk()",
        parameters: [],
      },
    ],
  },
  {
    name: "chunkInto",
    detail: "Pattern.chunkInto/temporal",
    documentation:
      "<p>Like <code>chunk</code>, but the function is applied to a looped subcycle of the source pattern.</p>",
    signatures: [
      {
        label: "chunkInto()",
        parameters: [],
      },
    ],
  },
  {
    name: "chunkBackInto",
    detail: "Pattern.chunkBackInto/temporal",
    documentation:
      "<p>Like <code>chunkInto</code>, but moves backwards through the chunks.</p>",
    signatures: [
      {
        label: "chunkBackInto()",
        parameters: [],
      },
    ],
  },
  {
    name: "ribbon",
    detail: "ribbon/temporal",
    documentation:
      "<p>Loops the pattern inside an <code>offset</code> for <code>cycles</code>.\nIf you think of the entire span of time in cycles as a ribbon, you can cut a single piece and loop it.</p>",
    signatures: [
      {
        label: "ribbon(offset, cycles)",
        parameters: [
          {
            label: "number offset",
            documentation: "<p>start point of loop in cycles</p>",
          },
          {
            label: "number cycles",
            documentation: "<p>loop length in cycles</p>",
          },
        ],
      },
    ],
  },
  {
    name: "hsla",
    detail: "hsla/visualization",
    documentation:
      '<p>Sets the pattern\'s color to the given <a href="https://www.w3schools.com/htmL/html_colors_hsl.asp">hsla</a></p>',
    signatures: [
      {
        label: "hsla(hue, saturation, lightness, alpha)",
        parameters: [
          {
            label: "Number hue",
            documentation: "<p>(0 - 360)</p>",
          },
          {
            label: "Number saturation",
            documentation: "<p>percentage (0 - 100)</p>",
          },
          {
            label: "Number lightness",
            documentation: "<p>percentage (0 - 100)</p>",
          },
          {
            label: "Number alpha",
            documentation: "<p>(transparency) (0.0 - 1.0)</p>",
          },
        ],
      },
    ],
  },
  {
    name: "hsl",
    detail: "hsl/visualization",
    documentation:
      '<p>Sets the pattern\'s color to the given <a href="https://www.w3schools.com/htmL/html_colors_hsl.asp">hsl</a></p>',
    signatures: [
      {
        label: "hsl(hue, saturation, lightness)",
        parameters: [
          {
            label: "Number hue",
            documentation: "<p>(0 - 360)</p>",
          },
          {
            label: "Number saturation",
            documentation: "<p>percentage (0 - 100)</p>",
          },
          {
            label: "Number lightness",
            documentation: "<p>percentage (0 - 100)</p>",
          },
        ],
      },
    ],
  },
  {
    name: "tag",
    detail: "tag/temporal",
    documentation:
      "<p>Tags each Hap with an identifier. Good for filtering. The function populates Hap.context.tags (Array).</p>",
    signatures: [
      {
        label: "tag(tag)",
        parameters: [
          {
            label: "string tag",
            documentation: "<p>anything unique</p>",
          },
        ],
      },
    ],
  },
  {
    name: "filter",
    detail: "filter/temporal,functional",
    documentation: "<p>Filters haps using the given function</p>",
    signatures: [
      {
        label: "filter(test)",
        parameters: [
          {
            label: "function test",
            documentation: "<p>function to test Hap</p>",
          },
        ],
      },
    ],
  },
  {
    name: "filterWhen",
    detail: "filterWhen/temporal,functional",
    documentation: "<p>Filters haps by their begin time</p>",
    signatures: [
      {
        label: "filterWhen(test)",
        parameters: [
          {
            label: "function test",
            documentation: "<p>function to test Hap.whole.begin</p>",
          },
        ],
      },
    ],
  },
  {
    name: "within",
    detail: "within/temporal,functional",
    documentation:
      "<p>Use within to apply a function to only a part of a pattern.</p>",
    signatures: [
      {
        label: "within(start, end, func)",
        parameters: [
          {
            label: "number start",
            documentation: "<p>start within cycle (0 - 1)</p>",
          },
          {
            label: "number end",
            documentation:
              "<p>end within cycle (0 - 1). Must be &gt; start</p>",
          },
          {
            label: "function func",
            documentation: "<p>function to be applied to the sub-pattern</p>",
          },
        ],
      },
    ],
  },
  {
    name: "pace",
    detail: "pace/stepwise",
    documentation:
      "<p><em>Experimental</em></p>\n<p>Speeds a pattern up or down, to fit to the given number of steps per cycle.</p>",
    signatures: [
      {
        label: "pace()",
        parameters: [],
      },
    ],
  },
  {
    name: "polymeter",
    detail: "polymeter/stepwise",
    documentation:
      "<p><em>Experimental</em></p>\n<p>Aligns the steps of the patterns, creating polymeters. The patterns are repeated until they all fit the cycle. For example, in the below the first pattern is repeated twice, and the second is repeated three times, to fit the lowest common multiple of six steps.</p>",
    signatures: [
      {
        label: "polymeter()",
        parameters: [],
      },
    ],
  },
  {
    name: "stepcat",
    detail: "stepcat/stepwise",
    documentation:
      "<p>'Concatenates' patterns like <code>fastcat</code>, but proportional to a number of steps per cycle.\nThe steps can either be inferred from the pattern, or provided as a [length, pattern] pair.\nHas the alias <code>timecat</code>.</p>",
    signatures: [
      {
        label: "stepcat()",
        parameters: [],
      },
    ],
  },
  {
    name: "stepalt",
    detail: "stepalt/stepwise",
    documentation:
      "<p><em>Experimental</em></p>\n<p>Concatenates patterns stepwise, according to an inferred 'steps per cycle'.\nSimilar to <code>stepcat</code>, but if an argument is a list, the whole pattern will alternate between the elements in the list.</p>",
    signatures: [
      {
        label: "stepalt()",
        parameters: [],
      },
    ],
  },
  {
    name: "take",
    detail: "take/stepwise",
    documentation:
      "<p><em>Experimental</em></p>\n<p>Takes the given number of steps from a pattern (dropping the rest).\nA positive number will take steps from the start of a pattern, and a negative number from the end.</p>",
    signatures: [
      {
        label: "take()",
        parameters: [],
      },
    ],
  },
  {
    name: "drop",
    detail: "drop/stepwise",
    documentation:
      "<p><em>Experimental</em></p>\n<p>Drops the given number of steps from a pattern.\nA positive number will drop steps from the start of a pattern, and a negative number from the end.</p>",
    signatures: [
      {
        label: "drop()",
        parameters: [],
      },
    ],
  },
  {
    name: "extend",
    detail: "extend/stepwise",
    documentation:
      "<p><em>Experimental</em></p>\n<p><code>extend</code> is similar to <code>fast</code> in that it increases its density, but it also increases the step count\naccordingly. So <code>stepcat(&quot;a b&quot;.extend(2), &quot;c d&quot;)</code> would be the same as <code>&quot;a b a b c d&quot;</code>, whereas\n<code>stepcat(&quot;a b&quot;.fast(2), &quot;c d&quot;)</code> would be the same as <code>&quot;[a b] [a b] c d&quot;</code>.</p>",
    signatures: [
      {
        label: "extend()",
        parameters: [],
      },
    ],
  },
  {
    name: "replicate",
    detail: "replicate/stepwise",
    documentation:
      "<p><em>Experimental</em></p>\n<p><code>replicate</code> is similar to <code>extend</code>, except that <code>replicate</code> will &quot;replicate&quot; the thing being extended. This will only differ from <code>extend</code> when the input pattern differs from cycle to cycle.</p>",
    signatures: [
      {
        label: "replicate()",
        parameters: [],
      },
    ],
  },
  {
    name: "expand",
    detail: "expand/stepwise",
    documentation:
      "<p><em>Experimental</em></p>\n<p>Expands the step size of the pattern by the given factor.</p>",
    signatures: [
      {
        label: "expand()",
        parameters: [],
      },
    ],
  },
  {
    name: "contract",
    detail: "contract/stepwise",
    documentation:
      "<p><em>Experimental</em></p>\n<p>Contracts the step size of the pattern by the given factor. See also <code>expand</code>.</p>",
    signatures: [
      {
        label: "contract()",
        parameters: [],
      },
    ],
  },
  {
    name: "shrink",
    detail: "shrink/stepwise",
    documentation:
      "<p><em>Experimental</em></p>\n<p>Progressively shrinks the pattern by 'n' steps until there's nothing left, or if a second value is given (using mininotation list syntax with <code>:</code>),\nthat number of times.\nA positive number will progressively drop steps from the start of a pattern, and a negative number from the end.</p>",
    signatures: [
      {
        label: "shrink()",
        parameters: [],
      },
    ],
  },
  {
    name: "grow",
    detail: "grow/stepwise",
    documentation:
      "<p><em>Experimental</em></p>\n<p>Progressively grows the pattern by 'n' steps until the full pattern is played, or if a second value is given (using mininotation list syntax with <code>:</code>),\nthat number of times.\nA positive number will progressively grow steps from the start of a pattern, and a negative number from the end.</p>",
    signatures: [
      {
        label: "grow()",
        parameters: [],
      },
    ],
  },
  {
    name: "tour",
    detail: "tour/stepwise",
    documentation:
      "<p><em>Experimental</em></p>\n<p>Inserts a pattern into a list of patterns. On the first repetition it will be inserted at the end of the list, then moved backwards through the list\non successive repetitions. The patterns are added together stepwise, with all repetitions taking place over a single cycle. Using <code>pace</code> to set the\nnumber of steps per cycle is therefore usually recommended.</p>",
    signatures: [
      {
        label: "tour()",
        parameters: [],
      },
    ],
  },
  {
    name: "zip",
    detail: "zip/stepwise",
    documentation:
      "<p><em>Experimental</em></p>\n<p>'zips' together the steps of the provided patterns. This can create a long repetition, taking place over a single, dense cycle.\nUsing <code>pace</code> to set the number of steps per cycle is therefore usually recommended.</p>",
    signatures: [
      {
        label: "zip()",
        parameters: [],
      },
    ],
  },
  {
    name: "timecat",
    detail: "timecat",
    documentation: "<p>Aliases for <code>stepcat</code></p>",
    signatures: [
      {
        label: "timecat()",
        parameters: [],
      },
    ],
  },
  {
    name: "chop",
    detail: "Pattern.chop/samples",
    documentation:
      "<p>Cuts each sample into the given number of parts, allowing you to explore a technique known as 'granular synthesis'.\nIt turns a pattern of samples into a pattern of parts of samples.</p>",
    signatures: [
      {
        label: "chop()",
        parameters: [],
      },
    ],
  },
  {
    name: "striate",
    detail: "Pattern.striate/samples",
    documentation:
      "<p>Cuts each sample into the given number of parts, triggering progressive portions of each sample at each loop.</p>",
    signatures: [
      {
        label: "striate()",
        parameters: [],
      },
    ],
  },
  {
    name: "loopAt",
    detail: "Pattern.loopAt/samples,pitch",
    documentation:
      "<p>Makes the sample fit the given number of cycles by changing the speed.</p>",
    signatures: [
      {
        label: "loopAt()",
        parameters: [],
      },
    ],
  },
  {
    name: "slice",
    detail: "Pattern.slice/samples",
    documentation:
      "<p>Chops samples into the given number of slices, triggering those slices with a given pattern of slice numbers.\nInstead of a number, it also accepts a list of numbers from 0 to 1 to slice at specific points.</p>",
    signatures: [
      {
        label: "slice()",
        parameters: [],
      },
    ],
  },
  {
    name: "onTriggerTime",
    detail: "Pattern.onTriggerTime/external_io",
    documentation:
      "<p>make something happen on event time\nuses browser timeout which is innacurate for audio tasks</p>",
    signatures: [
      {
        label: "onTriggerTime()",
        parameters: [],
      },
    ],
  },
  {
    name: "splice",
    detail: "splice/samples,pitch",
    documentation:
      "<p>Works the same as slice, but changes the playback speed of each slice to match the duration of its step.</p>",
    signatures: [
      {
        label: "splice()",
        parameters: [],
      },
    ],
  },
  {
    name: "fit",
    detail: "fit/samples,pitch",
    documentation:
      "<p>Makes the sample fit its event duration. Good for rhythmical loops like drum breaks.\nSimilar to <code>loopAt</code>.</p>",
    signatures: [
      {
        label: "fit()",
        parameters: [],
      },
    ],
  },
  {
    name: "loopAtCps",
    detail: "Pattern.loopAtCps/samples,pitch",
    documentation:
      "<p>Makes the sample fit the given number of cycles and cps value, by\nchanging the speed. deprecated: use loopAt or fit instead, together with setCps / setCpm.</p>",
    signatures: [
      {
        label: "loopAtCps()",
        parameters: [],
      },
    ],
  },
  {
    name: "ref",
    detail: "ref/internals",
    documentation:
      "<p>exposes a custom value at query time. basically allows mutating state without evaluation</p>",
    signatures: [
      {
        label: "ref()",
        parameters: [],
      },
    ],
  },
  {
    name: "xfade",
    detail: "xfade/amplitude",
    documentation:
      "<p>Cross-fades between left and right from 0 to 1:</p>\n<ul>\n<li>0 = (full left, no right)</li>\n<li>.5 = (both equal)</li>\n<li>1 = (no left, full right)</li>\n</ul>",
    signatures: [
      {
        label: "xfade()",
        parameters: [],
      },
    ],
  },
  {
    name: "beat",
    detail: "beat/temporal",
    documentation:
      "<p>creates a structure pattern from divisions of a cycle\nespecially useful for creating rhythms</p>",
    signatures: [
      {
        label: "beat()",
        parameters: [],
      },
    ],
  },
  {
    name: "morph",
    detail: "morph/temporal",
    documentation:
      "<p>Takes two binary rhythms represented as lists of 1s and 0s, and a number\nbetween 0 and 1 that morphs between them. The two lists should contain the same\nnumber of true values.</p>",
    signatures: [
      {
        label: "morph()",
        parameters: [],
      },
    ],
  },
  {
    name: "soft",
    detail: "soft/distortion,superdough",
    documentation: "<p>Soft-clipping distortion</p>",
    signatures: [
      {
        label: "soft(distortion, volume)",
        parameters: [
          {
            label: "number distortion",
            documentation: "<p>amount of distortion to apply</p>",
          },
          {
            label: "number volume",
            documentation: "<p>linear postgain of the distortion</p>",
          },
        ],
      },
    ],
  },
  {
    name: "hard",
    detail: "hard/distortion,superdough",
    documentation: "<p>Hard-clipping distortion</p>",
    signatures: [
      {
        label: "hard(distortion, volume)",
        parameters: [
          {
            label: "number distortion",
            documentation: "<p>amount of distortion to apply</p>",
          },
          {
            label: "number volume",
            documentation: "<p>linear postgain of the distortion</p>",
          },
        ],
      },
    ],
  },
  {
    name: "cubic",
    detail: "cubic/distortion,superdough",
    documentation: "<p>Cubic polynomial distortion</p>",
    signatures: [
      {
        label: "cubic(distortion, volume)",
        parameters: [
          {
            label: "number distortion",
            documentation: "<p>amount of distortion to apply</p>",
          },
          {
            label: "number volume",
            documentation: "<p>linear postgain of the distortion</p>",
          },
        ],
      },
    ],
  },
  {
    name: "diode",
    detail: "diode/distortion,superdough",
    documentation: "<p>Diode-emulating distortion</p>",
    signatures: [
      {
        label: "diode(distortion, volume)",
        parameters: [
          {
            label: "number distortion",
            documentation: "<p>amount of distortion to apply</p>",
          },
          {
            label: "number volume",
            documentation: "<p>linear postgain of the distortion</p>",
          },
        ],
      },
    ],
  },
  {
    name: "asym",
    detail: "asym/distortion,superdough",
    documentation: "<p>Asymmetrical diode distortion</p>",
    signatures: [
      {
        label: "asym(distortion, volume)",
        parameters: [
          {
            label: "number distortion",
            documentation: "<p>amount of distortion to apply</p>",
          },
          {
            label: "number volume",
            documentation: "<p>linear postgain of the distortion</p>",
          },
        ],
      },
    ],
  },
  {
    name: "fold",
    detail: "fold/distortion,superdough",
    documentation: "<p>Wavefolding distortion</p>",
    signatures: [
      {
        label: "fold(distortion, volume)",
        parameters: [
          {
            label: "number distortion",
            documentation: "<p>amount of distortion to apply</p>",
          },
          {
            label: "number volume",
            documentation: "<p>linear postgain of the distortion</p>",
          },
        ],
      },
    ],
  },
  {
    name: "sinefold",
    detail: "sinefold/distortion,superdough",
    documentation: "<p>Wavefolding distortion composed with sinusoid</p>",
    signatures: [
      {
        label: "sinefold(distortion, volume)",
        parameters: [
          {
            label: "number distortion",
            documentation: "<p>amount of distortion to apply</p>",
          },
          {
            label: "number volume",
            documentation: "<p>linear postgain of the distortion</p>",
          },
        ],
      },
    ],
  },
  {
    name: "chebyshev",
    detail: "chebyshev/distortion,superdough",
    documentation: "<p>Distortion via Chebyshev polynomials</p>",
    signatures: [
      {
        label: "chebyshev(distortion, volume)",
        parameters: [
          {
            label: "number distortion",
            documentation: "<p>amount of distortion to apply</p>",
          },
          {
            label: "number volume",
            documentation: "<p>linear postgain of the distortion</p>",
          },
        ],
      },
    ],
  },
  {
    name: "parray",
    detail: "parray/combiners",
    documentation:
      "<p>Turns a list of patterns into a single pattern which outputs list-values</p>",
    signatures: [
      {
        label: "parray()",
        parameters: [],
      },
    ],
  },
  {
    name: "partials",
    detail: "partials/superdough",
    documentation:
      "<p>Scale the magnitude of the harmonics of one of the core synths ('sine', 'tri', 'saw', ..)</p>\n<p>Can also be used to create a new synth via <code>s('user').partials(...)</code></p>",
    signatures: [
      {
        label: "partials(magnitudes)",
        parameters: [
          {
            label: "Array.<number> magnitudes",
            documentation:
              "<p>List of [0, 1] magnitudes for partials. 0th entry is the fundamental harmonic (i.e. DC offset is skipped)</p>",
          },
        ],
      },
    ],
  },
  {
    name: "phases",
    detail: "phases/superdough",
    documentation:
      "<p>Rotates the harmonics of one of the core synths ('sine', 'tri', 'saw', 'user', ..) by a list of phases</p>",
    signatures: [
      {
        label: "phases(phases)",
        parameters: [
          {
            label: "Array.<number> phases",
            documentation:
              "<p>List of [0, 1) phases for partials. 0th entry is the fundamental phase (i.e. DC offset is skipped)</p>",
          },
        ],
      },
    ],
  },
  {
    name: "FX",
    detail: "Pattern.FX/superdough",
    documentation:
      "<p>Establishes an FX chain. Can be called by chaining .FX(fx1).FX(fx2)..\ncalls and/or in a single .FX(fx1, fx2, ..) call. The fx1, .. are <em>patterns</em> which\nestablish the controls of the given effect. See examples.</p>",
    signatures: [
      {
        label: "FX()",
        parameters: [],
      },
    ],
  },
  {
    name: "K",
    detail: "Pattern.K/generators,superdough",
    documentation:
      "<p>Produces a <a href=\"https://kabel.salat.dev/\">Kabelsalat</a> modular sound engine.\nThis can be used as either an effect (by including <code>audioin()</code> at the beginning\nof your kabel expression) or as a sound source (via any expression which doesn't\nstart with <code>audioin()</code>).</p>\n<p>Some helpers you have available to you:</p>\n<ul>\n<li>Strudel mini notation works fine in K(..) via &quot;&quot; or ``</li>\n<li>More complex Strudel expressions (like &quot;0 1 2&quot;.fast(4) or irand(24)) can be\nwritten by wrapping them in <code>S(..)</code> inside your Kabel code</li>\n<li>We expose Strudel's note frequency under <code>sFreq</code> and Strudel's gate\ninformation under <code>sGate</code></li>\n<li>You can use more complex multi-line expressions (like <code>let x = a; let y = b; x.lpf(y);</code>)\nby wrapping them inside a function in K (see example).</li>\n</ul>",
    signatures: [
      {
        label: "K(expr)",
        parameters: [
          {
            label: "KabelsalatExpression expr",
            documentation: "<p>Kabelsalat graph definition</p>",
          },
        ],
      },
    ],
  },
  {
    name: "worklet",
    detail: "Pattern.worklet/noautocomplete",
    documentation:
      "<p>Creates a worklet effect. Typically derived by writing K(...) in the REPL which will parse\nKabelsalat code.</p>",
    signatures: [
      {
        label: "worklet(src, inputs)",
        parameters: [
          {
            label: "string src",
            documentation: "<p>Source code of the worklet update function</p>",
          },
          {
            label: "number inputs",
            documentation: "<p>Worklet inputs</p>",
          },
        ],
      },
    ],
  },
  {
    name: "base",
    detail: "base/generators",
    documentation:
      "<p>Creates a pattern of numbers in base b from a number or pattern of numbers\nlimited to d digits long from the right</p>",
    signatures: [
      {
        label: "base(n, b, d)",
        parameters: [
          {
            label: "number n",
            documentation:
              "<p>number to convert (can be a pattern or array)</p>",
          },
          {
            label: "number b",
            documentation:
              "<p>base to convert to (defaults to 10) (can be a pattern)</p>",
          },
          {
            label: "number d",
            documentation:
              "<p>max number of digits to produce for each n (defaults to 0 for all) (can be a pattern)</p>",
          },
        ],
      },
    ],
  },
  {
    name: "pick",
    detail: "pick/combiners",
    documentation:
      "<p>Picks patterns (or plain values) either from a list (by index) or a lookup table (by name).\nSimilar to <code>inhabit</code>, but maintains the structure of the original patterns.</p>",
    signatures: [
      {
        label: "pick(pat, xs)",
        parameters: [
          {
            label: "Pattern pat",
            documentation: "",
          },
          {
            label: "* xs",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "pickmod",
    detail: "pickmod/combiners",
    documentation:
      "<p>The same as <code>pick</code>, but if you pick a number greater than the size of the list,\nit wraps around, rather than sticking at the maximum value.\nFor example, if you pick the fifth pattern of a list of three, you'll get the\nsecond one.</p>",
    signatures: [
      {
        label: "pickmod(pat, xs)",
        parameters: [
          {
            label: "Pattern pat",
            documentation: "",
          },
          {
            label: "* xs",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "pickF",
    detail: "pickF/combiners,functional",
    documentation:
      "<p>pickF lets you use a pattern of numbers to pick which function to apply to another pattern.</p>",
    signatures: [
      {
        label: "pickF(pat, lookup, lookup)",
        parameters: [
          {
            label: "Pattern pat",
            documentation: "",
          },
          {
            label: "Pattern lookup",
            documentation: "<p>a pattern of indices or names</p>",
          },
          {
            label: "Array.<function()> lookup",
            documentation:
              "<p>the array or lookup object of functions from which to pull</p>",
          },
        ],
      },
    ],
  },
  {
    name: "pickmodF",
    detail: "pickmodF/combiners",
    documentation:
      "<p>The same as <code>pickF</code>, but if you pick a number greater than the size of the functions list,\nit wraps around, rather than sticking at the maximum value.</p>",
    signatures: [
      {
        label: "pickmodF(pat, lookup, lookup)",
        parameters: [
          {
            label: "Pattern pat",
            documentation: "",
          },
          {
            label: "Pattern lookup",
            documentation: "<p>a pattern of indices or names</p>",
          },
          {
            label: "Array.<function()> lookup",
            documentation:
              "<p>the array or lookup object of functions from which to pull</p>",
          },
        ],
      },
    ],
  },
  {
    name: "pickOut",
    detail: "pickOut/combiners",
    documentation:
      "<p>Similar to <code>pick</code>, but it applies an outerJoin instead of an innerJoin.</p>",
    signatures: [
      {
        label: "pickOut(pat, xs)",
        parameters: [
          {
            label: "Pattern pat",
            documentation: "",
          },
          {
            label: "* xs",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "pickmodOut",
    detail: "pickmodOut/combiners",
    documentation:
      "<p>The same as <code>pickOut</code>, but if you pick a number greater than the size of the list,\nit wraps around, rather than sticking at the maximum value.</p>",
    signatures: [
      {
        label: "pickmodOut(pat, xs)",
        parameters: [
          {
            label: "Pattern pat",
            documentation: "",
          },
          {
            label: "* xs",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "pickRestart",
    detail: "pickRestart/combiners",
    documentation:
      "<p>Similar to <code>pick</code>, but the choosen pattern is restarted when its index is triggered.</p>",
    signatures: [
      {
        label: "pickRestart(pat, xs)",
        parameters: [
          {
            label: "Pattern pat",
            documentation: "",
          },
          {
            label: "* xs",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "pickmodRestart",
    detail: "pickmodRestart/combiners",
    documentation:
      "<p>The same as <code>pickRestart</code>, but if you pick a number greater than the size of the list,\nit wraps around, rather than sticking at the maximum value.</p>",
    signatures: [
      {
        label: "pickmodRestart(pat, xs)",
        parameters: [
          {
            label: "Pattern pat",
            documentation: "",
          },
          {
            label: "* xs",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "pickReset",
    detail: "pickReset/combiners",
    documentation:
      "<p>Similar to <code>pick</code>, but the choosen pattern is reset when its index is triggered.</p>",
    signatures: [
      {
        label: "pickReset(pat, xs)",
        parameters: [
          {
            label: "Pattern pat",
            documentation: "",
          },
          {
            label: "* xs",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "pickmodReset",
    detail: "pickmodReset/combiners",
    documentation:
      "<p>The same as <code>pickReset</code>, but if you pick a number greater than the size of the list,\nit wraps around, rather than sticking at the maximum value.</p>",
    signatures: [
      {
        label: "pickmodReset(pat, xs)",
        parameters: [
          {
            label: "Pattern pat",
            documentation: "",
          },
          {
            label: "* xs",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "inhabit",
    detail: "inhabit/combiners",
    documentation:
      "<p>Picks patterns (or plain values) either from a list (by index) or a lookup table (by name).\nSimilar to <code>pick</code>, but cycles are squeezed into the target ('inhabited') pattern.</p>",
    signatures: [
      {
        label: "inhabit(pat, xs)",
        parameters: [
          {
            label: "Pattern pat",
            documentation: "",
          },
          {
            label: "* xs",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "inhabitmod",
    detail: "inhabitmod/combiners",
    documentation:
      "<p>The same as <code>inhabit</code>, but if you pick a number greater than the size of the list,\nit wraps around, rather than sticking at the maximum value.\nFor example, if you pick the fifth pattern of a list of three, you'll get the\nsecond one.</p>",
    signatures: [
      {
        label: "inhabitmod(pat, xs)",
        parameters: [
          {
            label: "Pattern pat",
            documentation: "",
          },
          {
            label: "* xs",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "squeeze",
    detail: "squeeze/combiners",
    documentation:
      "<p>Pick from the list of values (or patterns of values) via the index using the given\npattern of integers. The selected pattern will be compressed to fit the duration of the selecting event</p>",
    signatures: [
      {
        label: "squeeze(pat, xs)",
        parameters: [
          {
            label: "Pattern pat",
            documentation: "",
          },
          {
            label: "* xs",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "setcpm",
    detail: "setcpm/temporal",
    documentation:
      "<p>Changes the global tempo to the given cycles per minute</p>",
    signatures: [
      {
        label: "setcpm(cpm)",
        parameters: [
          {
            label: "number cpm",
            documentation: "<p>cycles per minute</p>",
          },
        ],
      },
    ],
  },
  {
    name: "all",
    detail: "repl~all/combiners",
    documentation:
      '<p>Applies a function to all the running patterns. Note that the patterns are grouped together into a single <code>stack</code> before the function is applied. This is probably what you want, but see <code>each</code> for\na version that applies the function to each pattern separately.</p>\n<p><strong>Note:</strong> Patterns must be labeled (e.g. with <code>$:</code>) to be picked up by <code>all</code>. An unlabeled\npattern such as <code>note(&quot;c4&quot;)</code> is not registered and will produce no audio when <code>all</code> is present.\nUse <code>$: note(&quot;c4&quot;)</code> instead.</p>\n<pre class="prettyprint source"><code>$: sound(&quot;bd - cp sd&quot;)\n$: sound(&quot;hh*8&quot;)\nall(fast(&quot;&lt;2 3>&quot;))\n</code></pre>\n<pre class="prettyprint source"><code>$: sound(&quot;bd - cp sd&quot;)\n$: sound(&quot;hh*8&quot;)\nall(x => x.pianoroll())\n</code></pre>',
    signatures: [
      {
        label: "all()",
        parameters: [],
      },
    ],
  },
  {
    name: "each",
    detail: "repl~each/combiners",
    documentation:
      "<p>Applies a function to each of the running patterns separately. This is intended for future use with upcoming 'stepwise' features. See <code>all</code> for a version that applies the function to all the patterns stacked together into a single pattern.</p>\n<p><strong>Note:</strong> Patterns must be labeled (e.g. with <code>$:</code>) to be picked up by <code>each</code>. An unlabeled\npattern such as <code>note(&quot;c4&quot;)</code> is not registered and will produce no audio when <code>each</code> is present.\nUse <code>$: note(&quot;c4&quot;)</code> instead.</p>\n<pre class=\"prettyprint source\"><code>$: sound(&quot;bd - cp sd&quot;)\n$: sound(&quot;hh*8&quot;)\neach(fast(&quot;&lt;2 3>&quot;))\n</code></pre>",
    signatures: [
      {
        label: "each()",
        parameters: [],
      },
    ],
  },
  {
    name: "getTime",
    detail: "getTime/internals",
    documentation: "",
    signatures: [
      {
        label: "getTime()",
        parameters: [],
      },
    ],
  },
  {
    name: "getClockTime",
    detail: "getClockTime/internals",
    documentation: "",
    signatures: [
      {
        label: "getClockTime()",
        parameters: [],
      },
    ],
  },
  {
    name: "getCps",
    detail: "getCps/internals",
    documentation: "",
    signatures: [
      {
        label: "getCps()",
        parameters: [],
      },
    ],
  },
  {
    name: "signal",
    detail: "signal/generators",
    documentation: "<p>Creates a signal given by the input function</p>",
    signatures: [
      {
        label: "signal(func)",
        parameters: [
          {
            label: "* func",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "saw",
    detail: "saw/generators",
    documentation: "<p>A sawtooth signal between 0 and 1.</p>",
    signatures: [
      {
        label: "saw()",
        parameters: [],
      },
    ],
  },
  {
    name: "saw2",
    detail: "saw2/generators",
    documentation:
      "<p>A sawtooth signal between -1 and 1 (like <code>saw</code>, but bipolar).</p>",
    signatures: [
      {
        label: "saw2()",
        parameters: [],
      },
    ],
  },
  {
    name: "isaw",
    detail: "isaw/generators",
    documentation:
      "<p>A sawtooth signal between 1 and 0 (like <code>saw</code>, but flipped).</p>",
    signatures: [
      {
        label: "isaw()",
        parameters: [],
      },
    ],
  },
  {
    name: "isaw2",
    detail: "isaw2/generators",
    documentation:
      "<p>A sawtooth signal between 1 and -1 (like <code>saw2</code>, but flipped).</p>",
    signatures: [
      {
        label: "isaw2()",
        parameters: [],
      },
    ],
  },
  {
    name: "sine2",
    detail: "sine2/generators",
    documentation:
      "<p>A sine signal between -1 and 1 (like <code>sine</code>, but bipolar).</p>",
    signatures: [
      {
        label: "sine2()",
        parameters: [],
      },
    ],
  },
  {
    name: "sine",
    detail: "sine/generators",
    documentation: "<p>A sine signal between 0 and 1.</p>",
    signatures: [
      {
        label: "sine()",
        parameters: [],
      },
    ],
  },
  {
    name: "cosine",
    detail: "cosine/generators",
    documentation: "<p>A cosine signal between 0 and 1.</p>",
    signatures: [
      {
        label: "cosine()",
        parameters: [],
      },
    ],
  },
  {
    name: "cosine2",
    detail: "cosine2/generators",
    documentation:
      "<p>A cosine signal between -1 and 1 (like <code>cosine</code>, but bipolar).</p>",
    signatures: [
      {
        label: "cosine2()",
        parameters: [],
      },
    ],
  },
  {
    name: "square",
    detail: "square/generators",
    documentation: "<p>A square signal between 0 and 1.</p>",
    signatures: [
      {
        label: "square()",
        parameters: [],
      },
    ],
  },
  {
    name: "square2",
    detail: "square2/generators",
    documentation:
      "<p>A square signal between -1 and 1 (like <code>square</code>, but bipolar).</p>",
    signatures: [
      {
        label: "square2()",
        parameters: [],
      },
    ],
  },
  {
    name: "isquare",
    detail: "isquare/generators",
    documentation:
      "<p>A square signal between 1 and 0 (like <code>square</code> but flipped).</p>",
    signatures: [
      {
        label: "isquare()",
        parameters: [],
      },
    ],
  },
  {
    name: "isquare2",
    detail: "isquare2/generators",
    documentation:
      "<p>A square signal between 1 and -1 (like <code>isquare</code>, but bipolar).</p>",
    signatures: [
      {
        label: "isquare2()",
        parameters: [],
      },
    ],
  },
  {
    name: "tri",
    detail: "tri/generators",
    documentation: "<p>A triangle signal between 0 and 1.</p>",
    signatures: [
      {
        label: "tri()",
        parameters: [],
      },
    ],
  },
  {
    name: "tri2",
    detail: "tri2/generators",
    documentation:
      "<p>A triangle signal between -1 and 1 (like <code>tri</code>, but bipolar).</p>",
    signatures: [
      {
        label: "tri2()",
        parameters: [],
      },
    ],
  },
  {
    name: "itri",
    detail: "itri/generators",
    documentation:
      "<p>An inverted triangle signal between 1 and 0 (like <code>tri</code>, but flipped).</p>",
    signatures: [
      {
        label: "itri()",
        parameters: [],
      },
    ],
  },
  {
    name: "itri2",
    detail: "itri2/generators",
    documentation:
      "<p>An inverted triangle signal between -1 and 1 (like <code>itri</code>, but bipolar).</p>",
    signatures: [
      {
        label: "itri2()",
        parameters: [],
      },
    ],
  },
  {
    name: "time",
    detail: "time/generators",
    documentation: "<p>A signal representing the cycle time.</p>",
    signatures: [
      {
        label: "time()",
        parameters: [],
      },
    ],
  },
  {
    name: "mousex",
    detail: "mousex/external_io",
    documentation: "<p>The mouse's x position value ranges from 0 to 1.</p>",
    signatures: [
      {
        label: "mousex()",
        parameters: [],
      },
    ],
  },
  {
    name: "mousey",
    detail: "mousey/external_io",
    documentation: "<p>The mouse's y position value ranges from 0 to 1.</p>",
    signatures: [
      {
        label: "mousey()",
        parameters: [],
      },
    ],
  },
  {
    name: "useRNG",
    detail: "useRNG/generators,math",
    documentation:
      "<p>Sets which random number generator to use. Historically Strudel would\nuse <code>useRNG('legacy')</code>, which remains the default. To use a new more statistically\nprecise RNG, try <code>useRNG('precise')</code>.</p>",
    signatures: [
      {
        label: "useRNG(mod)",
        parameters: [
          {
            label: "string mod",
            documentation: "<p>Mode. One of 'legacy', 'precise'</p>",
          },
        ],
      },
    ],
  },
  {
    name: "run",
    detail: "run/generators",
    documentation: "<p>A discrete pattern of numbers from 0 to n-1</p>",
    signatures: [
      {
        label: "run()",
        parameters: [],
      },
    ],
  },
  {
    name: "binary",
    detail: "binary/generators",
    documentation: "<p>Creates a binary pattern from a number.</p>",
    signatures: [
      {
        label: "binary(n)",
        parameters: [
          {
            label: "number n",
            documentation: "<p>input number to convert to binary</p>",
          },
        ],
      },
    ],
  },
  {
    name: "binaryN",
    detail: "binaryN/generators",
    documentation:
      "<p>Creates a binary pattern from a number, padded to n bits long.</p>",
    signatures: [
      {
        label: "binaryN(n, nBits)",
        parameters: [
          {
            label: "number n",
            documentation: "<p>input number to convert to binary</p>",
          },
          {
            label: "number nBits",
            documentation: "<p>pattern length, defaults to 16</p>",
          },
        ],
      },
    ],
  },
  {
    name: "binaryL",
    detail: "binaryL/generators",
    documentation: "<p>Creates a binary list pattern from a number.</p>",
    signatures: [
      {
        label: "binaryL(n)",
        parameters: [
          {
            label: "number n",
            documentation:
              "<p>input number to convert to binary\ns(&quot;saw&quot;).seg(8)\n.partials(binaryL(irand(4096).add(1)))</p>",
          },
        ],
      },
    ],
  },
  {
    name: "binaryNL",
    detail: "binaryNL/generators",
    documentation:
      "<p>Creates a binary list pattern from a number, padded to n bits long.</p>",
    signatures: [
      {
        label: "binaryNL(n, nBits)",
        parameters: [
          {
            label: "number n",
            documentation: "<p>input number to convert to binary</p>",
          },
          {
            label: "number nBits",
            documentation: "<p>pattern length, defaults to 16</p>",
          },
        ],
      },
    ],
  },
  {
    name: "randL",
    detail: "randL/generators",
    documentation:
      "<p>Creates a list of random numbers of the given length</p>",
    signatures: [
      {
        label: "randL(n)",
        parameters: [
          {
            label: "number n",
            documentation: "<p>Number of random numbers to sample</p>",
          },
        ],
      },
    ],
  },
  {
    name: "shuffle",
    detail: "shuffle/temporal",
    documentation:
      "<p>Slices a pattern into the given number of parts, then plays those parts in random order.\nEach part will be played exactly once per cycle.</p>",
    signatures: [
      {
        label: "shuffle()",
        parameters: [],
      },
    ],
  },
  {
    name: "scramble",
    detail: "scramble/temporal",
    documentation:
      "<p>Slices a pattern into the given number of parts, then plays those parts at random. Similar to <code>shuffle</code>,\nbut parts might be played more than once, or not at all, per cycle.</p>",
    signatures: [
      {
        label: "scramble()",
        parameters: [],
      },
    ],
  },
  {
    name: "withSeed",
    detail: "withSeed/math",
    documentation:
      "<p>Modify a pattern by applying a function to the <code>randomSeed</code> control if present</p>",
    signatures: [
      {
        label: "withSeed(func, pat)",
        parameters: [
          {
            label: "function func",
            documentation:
              "<p>Function from seed (or undefined) to seed (or undefined)</p>",
          },
          {
            label: "Pattern pat",
            documentation: "<p>Pattern to update</p>",
          },
        ],
      },
    ],
  },
  {
    name: "seed",
    detail: "seed/math",
    documentation:
      "<p>Change the seed for random signals. Normally, random signals depend on time,\nso two patterns at the same time will have the same random values. Specifying\na new seed changes the signal output by <code>rand</code>. This also affects other functions\nthat use randomness, like <code>shuffle</code> and <code>sometimes</code>.</p>",
    signatures: [
      {
        label: "seed(n)",
        parameters: [
          {
            label: "number n",
            documentation: "<p>A new seed. Can be any number.</p>",
          },
        ],
      },
    ],
  },
  {
    name: "rand",
    detail: "rand/generators",
    documentation:
      "<p>A continuous pattern of random numbers, between 0 and 1.</p>",
    signatures: [
      {
        label: "rand()",
        parameters: [],
      },
    ],
  },
  {
    name: "rand2",
    detail: "rand2/generators",
    documentation:
      "<p>A continuous pattern of random numbers, between -1 and 1</p>",
    signatures: [
      {
        label: "rand2()",
        parameters: [],
      },
    ],
  },
  {
    name: "brandBy",
    detail: "brandBy/generators",
    documentation:
      "<p>A continuous pattern of 0 or 1 (binary random), with a probability for the value being 1</p>",
    signatures: [
      {
        label: "brandBy(probability)",
        parameters: [
          {
            label: "number probability",
            documentation: "<p>a number between 0 and 1</p>",
          },
        ],
      },
    ],
  },
  {
    name: "brand",
    detail: "brand/generators",
    documentation: "<p>A continuous pattern of 0 or 1 (binary random)</p>",
    signatures: [
      {
        label: "brand()",
        parameters: [],
      },
    ],
  },
  {
    name: "irand",
    detail: "irand/generators",
    documentation:
      "<p>A continuous pattern of random integers, between 0 and n-1.</p>",
    signatures: [
      {
        label: "irand(n)",
        parameters: [
          {
            label: "number n",
            documentation: "<p>max value (exclusive)</p>",
          },
        ],
      },
    ],
  },
  {
    name: "chooseWith",
    detail: "chooseWith/temporal",
    documentation:
      "<p>Choose from the list of values (or patterns of values) using the given\npattern of numbers, which should be in the range of 0..1</p>",
    signatures: [
      {
        label: "chooseWith(pat, xs)",
        parameters: [
          {
            label: "Pattern pat",
            documentation: "",
          },
          {
            label: "* xs",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "chooseInWith",
    detail: "chooseInWith/temporal",
    documentation:
      "<p>As with {chooseWith}, but the structure comes from the chosen values, rather\nthan the pattern you're using to choose with.</p>",
    signatures: [
      {
        label: "chooseInWith(pat, xs)",
        parameters: [
          {
            label: "Pattern pat",
            documentation: "",
          },
          {
            label: "* xs",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "choose",
    detail: "choose/temporal",
    documentation: "<p>Chooses randomly from the given list of elements.</p>",
    signatures: [
      {
        label: "choose(xs)",
        parameters: [
          {
            label: "any xs",
            documentation: "<p>values / patterns to choose from.</p>",
          },
        ],
      },
    ],
  },
  {
    name: "choose",
    detail: "Pattern#choose/temporal",
    documentation:
      "<p>Chooses from the given list of values (or patterns of values), according\nto the pattern that the method is called on. The pattern should be in\nthe range 0 .. 1.</p>",
    signatures: [
      {
        label: "choose(xs)",
        parameters: [
          {
            label: "any xs",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "choose2",
    detail: "Pattern#choose2/temporal",
    documentation:
      "<p>As with choose, but the pattern that this method is called on should be\nin the range -1 .. 1</p>",
    signatures: [
      {
        label: "choose2(xs)",
        parameters: [
          {
            label: "any xs",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "chooseCycles",
    detail: "chooseCycles/temporal",
    documentation: "<p>Picks one of the elements at random each cycle.</p>",
    signatures: [
      {
        label: "chooseCycles()",
        parameters: [],
      },
    ],
  },
  {
    name: "wchoose",
    detail: "wchoose/temporal",
    documentation:
      "<p>Chooses randomly from the given list of elements by giving a probability to each element</p>",
    signatures: [
      {
        label: "wchoose(pairs)",
        parameters: [
          {
            label: "any pairs",
            documentation: "<p>arrays of value and weight</p>",
          },
        ],
      },
    ],
  },
  {
    name: "wchooseCycles",
    detail: "wchooseCycles/temporal",
    documentation:
      "<p>Picks one of the elements at random each cycle by giving a probability to each element</p>",
    signatures: [
      {
        label: "wchooseCycles()",
        parameters: [],
      },
    ],
  },
  {
    name: "perlin",
    detail: "perlin/generators",
    documentation:
      '<p>Generates a continuous pattern of <a href="https://en.wikipedia.org/wiki/Perlin_noise">perlin noise</a>, in the range 0..1.</p>',
    signatures: [
      {
        label: "perlin()",
        parameters: [],
      },
    ],
  },
  {
    name: "berlin",
    detail: "berlin/generators",
    documentation:
      "<p>Generates a continuous pattern of [berlin noise](conceived by Jame Coyne and Jade Rowland as a joke but turned out to be surprisingly cool and useful,\nlike perlin noise but with sawtooth waves), in the range 0..1.</p>",
    signatures: [
      {
        label: "berlin()",
        parameters: [],
      },
    ],
  },
  {
    name: "degradeByWith",
    detail: "Pattern.degradeByWith/temporal",
    documentation:
      "<p><code>degradeByWith</code> is like <code>degradeBy</code>, but with control over the random or other signal used to filter out the events.</p>\n<p><code>degradeBy(x)</code> is essentially <code>degradeByWith(rand, x)</code></p>\n<p>This allows you to do things other than with <code>rand</code>, see examples below</p>",
    signatures: [
      {
        label: "degradeByWith(test, testAgainst)",
        parameters: [
          {
            label: "Pattern test",
            documentation: "",
          },
          {
            label: "Pattern testAgainst",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "degradeBy",
    detail: "Pattern.degradeBy/temporal",
    documentation:
      "<p>Randomly removes events from the pattern by a given amount.\n0 = 0% chance of removal\n1 = 100% chance of removal</p>",
    signatures: [
      {
        label: "degradeBy(amount)",
        parameters: [
          {
            label: "number amount",
            documentation: "<p>a number between 0 and 1</p>",
          },
        ],
      },
    ],
  },
  {
    name: "degrade",
    detail: "Pattern.degrade/temporal",
    documentation:
      "<p>Randomly removes 50% of events from the pattern. Shorthand for <code>.degradeBy(0.5)</code></p>",
    signatures: [
      {
        label: "degrade()",
        parameters: [],
      },
    ],
  },
  {
    name: "undegradeBy",
    detail: "Pattern.undegradeBy/temporal",
    documentation:
      "<p>Inverse of <code>degradeBy</code>: Randomly removes events from the pattern by a given amount.\n0 = 100% chance of removal\n1 = 0% chance of removal\nEvents that would be removed by degradeBy are let through by undegradeBy and vice versa (see second example).</p>",
    signatures: [
      {
        label: "undegradeBy(amount)",
        parameters: [
          {
            label: "number amount",
            documentation: "<p>a number between 0 and 1</p>",
          },
        ],
      },
    ],
  },
  {
    name: "undegrade",
    detail: "Pattern.undegrade/temporal",
    documentation:
      "<p>Inverse of <code>degrade</code>: Randomly removes 50% of events from the pattern. Shorthand for <code>.undegradeBy(0.5)</code>\nEvents that would be removed by degrade are let through by undegrade and vice versa (see second example).</p>",
    signatures: [
      {
        label: "undegrade()",
        parameters: [],
      },
    ],
  },
  {
    name: "sometimesBy",
    detail: "Pattern.sometimesBy/temporal",
    documentation:
      "<p>Randomly applies the given function by the given probability.\nSimilar to <code>someCyclesBy</code></p>",
    signatures: [
      {
        label: "sometimesBy(probability, function)",
        parameters: [
          {
            label: "number probability",
            documentation: "<p>a number between 0 and 1</p>",
          },
          {
            label: "function function",
            documentation: "<p>the transformation to apply</p>",
          },
        ],
      },
    ],
  },
  {
    name: "sometimes",
    detail: "Pattern.sometimes/temporal",
    documentation: "<p>Applies the given function with a 50% chance</p>",
    signatures: [
      {
        label: "sometimes(function)",
        parameters: [
          {
            label: "function function",
            documentation: "<p>the transformation to apply</p>",
          },
        ],
      },
    ],
  },
  {
    name: "someCyclesBy",
    detail: "Pattern.someCyclesBy/temporal",
    documentation:
      "<p>Randomly applies the given function by the given probability on a cycle by cycle basis.\nSimilar to <code>sometimesBy</code></p>",
    signatures: [
      {
        label: "someCyclesBy(probability, function)",
        parameters: [
          {
            label: "number probability",
            documentation: "<p>a number between 0 and 1</p>",
          },
          {
            label: "function function",
            documentation: "<p>the transformation to apply</p>",
          },
        ],
      },
    ],
  },
  {
    name: "someCycles",
    detail: "Pattern.someCycles/temporal",
    documentation: "<p>Shorthand for <code>.someCyclesBy(0.5, fn)</code></p>",
    signatures: [
      {
        label: "someCycles()",
        parameters: [],
      },
    ],
  },
  {
    name: "often",
    detail: "Pattern.often/temporal",
    documentation: "<p>Shorthand for <code>.sometimesBy(0.75, fn)</code></p>",
    signatures: [
      {
        label: "often()",
        parameters: [],
      },
    ],
  },
  {
    name: "rarely",
    detail: "Pattern.rarely/temporal",
    documentation: "<p>Shorthand for <code>.sometimesBy(0.25, fn)</code></p>",
    signatures: [
      {
        label: "rarely()",
        parameters: [],
      },
    ],
  },
  {
    name: "almostNever",
    detail: "Pattern.almostNever/temporal",
    documentation: "<p>Shorthand for <code>.sometimesBy(0.1, fn)</code></p>",
    signatures: [
      {
        label: "almostNever()",
        parameters: [],
      },
    ],
  },
  {
    name: "almostAlways",
    detail: "Pattern.almostAlways/temporal",
    documentation: "<p>Shorthand for <code>.sometimesBy(0.9, fn)</code></p>",
    signatures: [
      {
        label: "almostAlways()",
        parameters: [],
      },
    ],
  },
  {
    name: "never",
    detail: "Pattern.never/temporal",
    documentation:
      "<p>Shorthand for <code>.sometimesBy(0, fn)</code> (never calls fn)</p>",
    signatures: [
      {
        label: "never()",
        parameters: [],
      },
    ],
  },
  {
    name: "always",
    detail: "Pattern.always/temporal",
    documentation:
      "<p>Shorthand for <code>.sometimesBy(1, fn)</code> (always calls fn)</p>",
    signatures: [
      {
        label: "always()",
        parameters: [],
      },
    ],
  },
  {
    name: "whenKey",
    detail: "Pattern.whenKey/external_io",
    documentation:
      '<p>Do something on a keypress, or array of keypresses\n<a href="https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_key_values">Key name reference</a></p>',
    signatures: [
      {
        label: "whenKey()",
        parameters: [],
      },
    ],
  },
  {
    name: "keyDown",
    detail: "Pattern.keyDown/external_io",
    documentation:
      '<p>returns true when a key or array of keys is held\n<a href="https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_key_values">Key name reference</a></p>',
    signatures: [
      {
        label: "keyDown()",
        parameters: [],
      },
    ],
  },
  {
    name: "cyclesPer",
    detail: "cyclesPer/temporal",
    documentation:
      "<p>A pattern measuring the duration of events,\nin cycles per event. <code>cyclesPer</code> doesn't have structure itself, but takes structure, and therefore\nevent durations, from the pattern that it is combined with.\nFor example <code>cyclesPer.struct(&quot;1 1 [1 1] 1&quot;)</code> would give the same as <code>&quot;0.25 0.25 [0.125 0.125] 0.25&quot;</code>.\nSee also its reciprocal, <code>per</code>, also known as <code>perCycle</code>.</p>",
    signatures: [
      {
        label: "cyclesPer()",
        parameters: [],
      },
    ],
  },
  {
    name: "per",
    detail: "per/temporal",
    documentation:
      "<p>A pattern measuring the 'shortness' of events, or in other words, the duration of pattern events,\nin events per cycle. <code>per</code> doesn't have structure itself, but takes structure, and therefore\nevent durations, from the pattern that it is combined with.\nFor example <code>per.struct(&quot;1 1 [1 1] 1&quot;)</code> would give the same as <code>&quot;4 4 [8 8] 4&quot;</code>.\nSee also its reciprocal, <code>cyclesPer</code>.</p>",
    signatures: [
      {
        label: "per()",
        parameters: [],
      },
    ],
  },
  {
    name: "perx",
    detail: "perx/temporal",
    documentation:
      "<p>Like <code>per</code> but measures the shortness of events according to an exponential curve. In\nparticular, where the event duration halves, the\nreturned value increases by one. <code>perx.struct(&quot;1 1 [1 [1 1]] 1&quot;)</code> would therefore be\nthe same as <code>&quot;3 3 [4 [5 5]] 3&quot;</code>.</p>",
    signatures: [
      {
        label: "perx()",
        parameters: [],
      },
    ],
  },
  {
    name: "open",
    detail: "open/temporal",
    documentation:
      "<p>A signal that goes from <code>0</code> to <code>1</code> over one cycle, and then stays at <code>1</code> forever.\nMainly useful in combination with other functions that reset the cycle. See also\n<code>close</code>.</p>",
    signatures: [
      {
        label: "open()",
        parameters: [],
      },
    ],
  },
  {
    name: "close",
    detail: "close/temporal",
    documentation:
      "<p>The same as <code>open</code>, but goes from <code>1</code> to <code>0</code> over one cycle, and then\nstays on <code>0</code> forever.</p>",
    signatures: [
      {
        label: "close()",
        parameters: [],
      },
    ],
  },
  {
    name: "midi2note",
    detail: "midi2note/noautocomplete",
    documentation: "",
    signatures: [
      {
        label: "midi2note()",
        parameters: [],
      },
    ],
  },
  {
    name: "getFrequency",
    detail: "getFrequency/pitch",
    documentation:
      "<p>Given a hap, returns the frequency of the note or freq, if defined</p>\n<p>Given a note, returns the frequency of that note\n<code>getFreq('c3')</code></p>\n<p>Given a midi note number, returns the frequency of that midi note\n<code>getFreq('c3')</code></p>",
    signatures: [
      {
        label: "getFrequency(input)",
        parameters: [
          {
            label: "Hap input",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "csoundm",
    detail: "csoundm/external_io",
    documentation:
      "<p>Sends notes to Csound for rendering with MIDI semantics. The hap value is\ntranslated to these Csound pfields:</p>\n<p>p1 -- Csound instrument either as a number (1-based, can be a fraction),\nor as a string name.\np2 -- time in beats (usually seconds) from start of performance.\np3 -- duration in beats (usually seconds).\np4 -- MIDI key number (as a real number, not an integer but in [0, 127].\np5 -- MIDI velocity (as a real number, not an integer but in [0, 127].\np6 -- Strudel controls, as a string.</p>",
    signatures: [
      {
        label: "csoundm()",
        parameters: [],
      },
    ],
  },
  {
    name: "initDough",
    detail: "Pattern.initDough/external_io",
    documentation:
      "<p>initializes dough ahead of time. you don't need to use this, but if you do, you can await it, so dough is ready before the pattern starts.</p>",
    signatures: [
      {
        label: "initDough()",
        parameters: [],
      },
    ],
  },
  {
    name: "dough",
    detail: "Pattern.dough/external_io",
    documentation:
      "<p>Uses dough as the audio engine. more info at https://dough.strudel.cc</p>",
    signatures: [
      {
        label: "dough()",
        parameters: [],
      },
    ],
  },
  {
    name: "pianoroll",
    detail: "pianoroll/visualization",
    documentation:
      "<p>Visualises a pattern as a scrolling 'pianoroll', displayed in the background of the editor. To show a pianoroll for all running patterns, use <code>all(pianoroll)</code>. To have a pianoroll appear below\na pattern instead, prefix with <code>_</code>, e.g.: <code>sound(&quot;bd sd&quot;)._pianoroll()</code>.</p>",
    signatures: [
      {
        label:
          "pianoroll(options, cycles, playhead, vertical, labels, flipTime, flipValues, overscan, hideNegative, smear, fold, active, inactive, background, playheadColor, fill, fillActive, stroke, strokeActive, hideInactive, colorizeInactive, fontFamily, minMidi, maxMidi, autorange)",
        parameters: [
          {
            label: "Object options",
            documentation:
              "<p>Object containing all the optional following parameters as key value pairs:</p>",
          },
          {
            label: "integer cycles",
            documentation:
              "<p>number of cycles to be displayed at the same time - defaults to 4</p>",
          },
          {
            label: "number playhead",
            documentation:
              "<p>location of the active notes on the time axis - 0 to 1, defaults to 0.5</p>",
          },
          {
            label: "boolean vertical",
            documentation: "<p>displays the roll vertically - 0 by default</p>",
          },
          {
            label: "boolean labels",
            documentation:
              "<p>displays labels on individual notes (see the label function) - 0 by default</p>",
          },
          {
            label: "boolean flipTime",
            documentation:
              "<p>reverse the direction of the roll - 0 by default</p>",
          },
          {
            label: "boolean flipValues",
            documentation:
              "<p>reverse the relative location of notes on the value axis - 0 by default</p>",
          },
          {
            label: "number overscan",
            documentation:
              "<p>lookup X cycles outside of the cycles window to display notes in advance - 1 by default</p>",
          },
          {
            label: "boolean hideNegative",
            documentation:
              "<p>hide notes with negative time (before starting playing the pattern) - 0 by default</p>",
          },
          {
            label: "boolean smear",
            documentation: "<p>notes leave a solid trace - 0 by default</p>",
          },
          {
            label: "boolean fold",
            documentation:
              "<p>notes takes the full value axis width - 0 by default</p>",
          },
          {
            label: "string active",
            documentation:
              "<p>hexadecimal or CSS color of the active notes - defaults to #FFCA28</p>",
          },
          {
            label: "string inactive",
            documentation:
              "<p>hexadecimal or CSS color of the inactive notes - defaults to #7491D2</p>",
          },
          {
            label: "string background",
            documentation:
              "<p>hexadecimal or CSS color of the background - defaults to transparent</p>",
          },
          {
            label: "string playheadColor",
            documentation:
              "<p>hexadecimal or CSS color of the line representing the play head - defaults to white</p>",
          },
          {
            label: "boolean fill",
            documentation:
              "<p>notes are filled with color (otherwise only the label is displayed) - 0 by default</p>",
          },
          {
            label: "boolean fillActive",
            documentation:
              "<p>active notes are filled with color - 0 by default</p>",
          },
          {
            label: "boolean stroke",
            documentation:
              "<p>notes are shown with colored borders - 0 by default</p>",
          },
          {
            label: "boolean strokeActive",
            documentation:
              "<p>active notes are shown with colored borders - 0 by default</p>",
          },
          {
            label: "boolean hideInactive",
            documentation: "<p>only active notes are shown - 0 by default</p>",
          },
          {
            label: "boolean colorizeInactive",
            documentation:
              "<p>use note color for inactive notes - 1 by default</p>",
          },
          {
            label: "string fontFamily",
            documentation:
              "<p>define the font used by notes labels - defaults to 'monospace'</p>",
          },
          {
            label: "integer minMidi",
            documentation:
              "<p>minimum note value to display on the value axis - defaults to 10</p>",
          },
          {
            label: "integer maxMidi",
            documentation:
              "<p>maximum note value to display on the value axis - defaults to 90</p>",
          },
          {
            label: "boolean autorange",
            documentation:
              "<p>automatically calculate the minMidi and maxMidi parameters - 0 by default</p>",
          },
        ],
      },
    ],
  },
  {
    name: "wordfall",
    detail: "wordfall/visualization",
    documentation:
      "<p>Displays a vertical pianoroll with event labels.\nSupports all the same options as pianoroll.</p>",
    signatures: [
      {
        label: "wordfall()",
        parameters: [],
      },
    ],
  },
  {
    name: "pitchwheel",
    detail: "pitchwheel/visualization",
    documentation:
      "<p>Renders a pitch circle to visualize frequencies within one octave</p>",
    signatures: [
      {
        label:
          "pitchwheel(hapcircles, circle, edo, root, thickness, hapRadius, mode, margin)",
        parameters: [
          {
            label: "number hapcircles",
            documentation: "",
          },
          {
            label: "number circle",
            documentation: "",
          },
          {
            label: "number edo",
            documentation: "",
          },
          {
            label: "string root",
            documentation: "",
          },
          {
            label: "number thickness",
            documentation: "",
          },
          {
            label: "number hapRadius",
            documentation: "",
          },
          {
            label: "string mode",
            documentation: "",
          },
          {
            label: "number margin",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "spiral",
    detail: "spiral/visualization",
    documentation: "<p>Displays a spiral visual.</p>",
    signatures: [
      {
        label:
          "spiral(options, stretch, size, thickness, cap, inset, playheadColor, playheadLength, playheadThickness, padding, steady, activeColor, inactiveColor, colorizeInactive, fade, logSpiral)",
        parameters: [
          {
            label: "Object options",
            documentation:
              "<p>Object containing all the optional following parameters as key value pairs:</p>",
          },
          {
            label: "number stretch",
            documentation:
              "<p>controls the rotations per cycle ratio, where 1 = 1 cycle / 360 degrees</p>",
          },
          {
            label: "number size",
            documentation: "<p>the diameter of the spiral</p>",
          },
          {
            label: "number thickness",
            documentation: "<p>line thickness</p>",
          },
          {
            label: "string cap",
            documentation:
              "<p>style of line ends: butt (default), round, square</p>",
          },
          {
            label: "string inset",
            documentation:
              "<p>number of rotations before spiral starts (default 3)</p>",
          },
          {
            label: "string playheadColor",
            documentation: "<p>color of playhead, defaults to white</p>",
          },
          {
            label: "number playheadLength",
            documentation:
              "<p>length of playhead in rotations, defaults to 0.02</p>",
          },
          {
            label: "number playheadThickness",
            documentation:
              "<p>thickness of playheadrotations, defaults to thickness</p>",
          },
          {
            label: "number padding",
            documentation: "<p>space around spiral</p>",
          },
          {
            label: "number steady",
            documentation:
              "<p>steadyness of spiral vs playhead. 1 = spiral doesn't move, playhead does.</p>",
          },
          {
            label: "number activeColor",
            documentation:
              "<p>color of active segment. defaults to foreground of theme</p>",
          },
          {
            label: "number inactiveColor",
            documentation:
              "<p>color of inactive segments. defaults to gutterForeground of theme</p>",
          },
          {
            label: "boolean colorizeInactive",
            documentation:
              "<p>wether or not to colorize inactive segments, defaults to 0</p>",
          },
          {
            label: "boolean fade",
            documentation:
              "<p>wether or not past and future should fade out. defaults to 1</p>",
          },
          {
            label: "boolean logSpiral",
            documentation:
              "<p>wether or not the spiral should be logarithmic. defaults to 0</p>",
          },
        ],
      },
    ],
  },
  {
    name: "edoScale",
    detail: "edoScale",
    documentation:
      "<p>Turns numbers into notes in the given EDO scale (zero indexed).</p>\n<p>An EDO scale definition looks like this:</p>\n<p>e.g. C:LLsLLLs:2:1 &lt;- this is the C major scale, 12 EDO</p>\n<p>e.g. C:LLsLLL:3:1 &lt;- this is the Gorgo 6 note scale, 16 EDO</p>\n<p>An EDO scale, e.g. C:LLsLLLs:2:1, consists of a root note (e.g. C)\nfollowed by semicolon (':')\nand then a <a href=\"https://en.xen.wiki/w/MOS_scale\">Large/small step notation sequence</a>\n(e.g. LLsLLLs)\nfollowed by semicolon, then the large step size (e.g. 2)\nfollowed by semicolon, then the small step size (e.g. 1).</p>\n<p>The number of divisions of the octave is calculated as the sum\nof the steps in the EDO scale definition.</p>\n<p>e.g. C:LLsLLLs:2:1 is 2+2+1+2+2+2+1 = 12 EDO, 7 note scale</p>\n<p>e.g. C:LLsLLL:3:1 is 3+3+1+3+3+3 = 16 EDO, 6 note scale</p>\n<p>The root note defaults to octave 3, if no octave number is given.</p>",
    signatures: [
      {
        label: "edoScale(scale)",
        parameters: [
          {
            label: "string scale",
            documentation: "<p>Definition of EDO scale.</p>",
          },
        ],
      },
    ],
  },
  {
    name: "MidiInput",
    detail: "MidiInput",
    documentation: "",
    signatures: [
      {
        label: "MidiInput(input)",
        parameters: [
          {
            label: "string input",
            documentation: "<p>MIDI device name or index defaulting to 0</p>",
          },
        ],
      },
    ],
  },
  {
    name: "createCC",
    detail: "MidiInput#createCC",
    documentation:
      "<p>Implementation for the cc() factory function tied to this specific input.</p>",
    signatures: [
      {
        label: "createCC(cc, chan)",
        parameters: [
          {
            label: "number cc",
            documentation: "<p>MIDI CC number</p>",
          },
          {
            label: "number chan",
            documentation:
              "<p>MIDI channel (1-16) or undefined for all channels</p>",
          },
        ],
      },
    ],
  },
  {
    name: "defaultmidimap",
    detail: "defaultmidimap/external_io,midi",
    documentation:
      "<p>configures the default midimap, which is used when no &quot;midimap&quot; port is set</p>",
    signatures: [
      {
        label: "defaultmidimap()",
        parameters: [],
      },
    ],
  },
  {
    name: "midimaps",
    detail: "midimaps/external_io,midi",
    documentation:
      "<p>Adds midimaps to the registry. Inside each midimap, control names (e.g. lpf) are mapped to cc numbers.</p>",
    signatures: [
      {
        label: "midimaps()",
        parameters: [],
      },
    ],
  },
  {
    name: "midi",
    detail: "Pattern#midi/external_io",
    documentation: "<p>MIDI output: Opens a MIDI output port.</p>",
    signatures: [
      {
        label: "midi(midiport, options)",
        parameters: [
          {
            label: "string midiport",
            documentation: "<p>MIDI device name or index defaulting to 0</p>",
          },
          {
            label: "object options",
            documentation: "<p>Additional MIDI configuration options</p>",
          },
        ],
      },
    ],
  },
  {
    name: "_initializeInput",
    detail: "_initializeInput",
    documentation: "<p>Initialize a midi input device</p>",
    signatures: [
      {
        label: "_initializeInput()",
        parameters: [],
      },
    ],
  },
  {
    name: "midin",
    detail: "midin/external_io,midi",
    documentation:
      "<p>MIDI input: Opens a MIDI input port to receive MIDI control change messages.</p>\n<p>The output is a function that accepts a midi cc value to query as well as (optionally) a midi channel</p>",
    signatures: [
      {
        label: "midin(input)",
        parameters: [
          {
            label: "string input",
            documentation: "<p>MIDI device name or index defaulting to 0</p>",
          },
        ],
      },
    ],
  },
  {
    name: "midikeys",
    detail: "midikeys/external_io,midi",
    documentation:
      "<p>MIDI keyboard: Opens a MIDI input port to receive MIDI keyboard messages.</p>\n<p>The note length is fixed as Superdough is not currently set up for undetermined\nnote durations</p>\n<p>The 'midichan' control value contains the number of the channel the note is coming from\nso it could be filtered or manipulated further in the chain.</p>",
    signatures: [
      {
        label: "midikeys(input)",
        parameters: [
          {
            label: "string input",
            documentation: "<p>MIDI device name or index defaulting to 0</p>",
          },
        ],
      },
    ],
  },
  {
    name: "getMidiDeviceNamesString",
    detail: "getMidiDeviceNamesString",
    documentation:
      "<p>Get a string listing device names for error messages.</p>",
    signatures: [
      {
        label: "getMidiDeviceNamesString(devices)",
        parameters: [
          {
            label: "Array.<Input> devices",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "getDevice",
    detail: "getDevice",
    documentation:
      "<p>Look up a device by index or name. Otherwise return a default device, or fail if none are connected.</p>",
    signatures: [
      {
        label: "getDevice(indexOrName, devices)",
        parameters: [
          {
            label: "string indexOrName",
            documentation: "",
          },
          {
            label: "Array.<Input> devices",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "accelerationX",
    detail: "accelerationX/external_io",
    documentation:
      "<p>The accelerometer's x-axis value ranges from 0 to 1.</p>",
    signatures: [
      {
        label: "accelerationX()",
        parameters: [],
      },
    ],
  },
  {
    name: "accelerationY",
    detail: "accelerationY/external_io",
    documentation:
      "<p>The accelerometer's y-axis value ranges from 0 to 1.</p>",
    signatures: [
      {
        label: "accelerationY()",
        parameters: [],
      },
    ],
  },
  {
    name: "accelerationZ",
    detail: "accelerationZ/external_io",
    documentation:
      "<p>The accelerometer's z-axis value ranges from 0 to 1.</p>",
    signatures: [
      {
        label: "accelerationZ()",
        parameters: [],
      },
    ],
  },
  {
    name: "gravityX",
    detail: "gravityX/external_io",
    documentation:
      "<p>The device's gravity x-axis value ranges from 0 to 1.</p>",
    signatures: [
      {
        label: "gravityX()",
        parameters: [],
      },
    ],
  },
  {
    name: "gravityY",
    detail: "gravityY/external_io",
    documentation:
      "<p>The device's gravity y-axis value ranges from 0 to 1.</p>",
    signatures: [
      {
        label: "gravityY()",
        parameters: [],
      },
    ],
  },
  {
    name: "gravityZ",
    detail: "gravityZ/external_io",
    documentation:
      "<p>The device's gravity z-axis value ranges from 0 to 1.</p>",
    signatures: [
      {
        label: "gravityZ()",
        parameters: [],
      },
    ],
  },
  {
    name: "rotationAlpha",
    detail: "rotationAlpha/external_io",
    documentation:
      "<p>The device's rotation around the alpha-axis value ranges from 0 to 1.</p>",
    signatures: [
      {
        label: "rotationAlpha()",
        parameters: [],
      },
    ],
  },
  {
    name: "rotationBeta",
    detail: "rotationBeta/external_io",
    documentation:
      "<p>The device's rotation around the beta-axis value ranges from 0 to 1.</p>",
    signatures: [
      {
        label: "rotationBeta()",
        parameters: [],
      },
    ],
  },
  {
    name: "rotationGamma",
    detail: "rotationGamma/external_io",
    documentation:
      "<p>The device's rotation around the gamma-axis value ranges from 0 to 1.</p>",
    signatures: [
      {
        label: "rotationGamma()",
        parameters: [],
      },
    ],
  },
  {
    name: "orientationAlpha",
    detail: "orientationAlpha/external_io",
    documentation:
      "<p>The device's orientation alpha value ranges from 0 to 1.</p>",
    signatures: [
      {
        label: "orientationAlpha()",
        parameters: [],
      },
    ],
  },
  {
    name: "orientationBeta",
    detail: "orientationBeta/external_io",
    documentation:
      "<p>The device's orientation beta value ranges from 0 to 1.</p>",
    signatures: [
      {
        label: "orientationBeta()",
        parameters: [],
      },
    ],
  },
  {
    name: "orientationGamma",
    detail: "orientationGamma/external_io",
    documentation:
      "<p>The device's orientation gamma value ranges from 0 to 1.</p>",
    signatures: [
      {
        label: "orientationGamma()",
        parameters: [],
      },
    ],
  },
  {
    name: "absoluteOrientationAlpha",
    detail: "absoluteOrientationAlpha/external_io",
    documentation:
      "<p>The device's absolute orientation alpha value ranges from 0 to 1.</p>",
    signatures: [
      {
        label: "absoluteOrientationAlpha()",
        parameters: [],
      },
    ],
  },
  {
    name: "absoluteOrientationBeta",
    detail: "absoluteOrientationBeta/external_io",
    documentation:
      "<p>The device's absolute orientation beta value ranges from 0 to 1.</p>",
    signatures: [
      {
        label: "absoluteOrientationBeta()",
        parameters: [],
      },
    ],
  },
  {
    name: "absoluteOrientationGamma",
    detail: "absoluteOrientationGamma/external_io",
    documentation:
      "<p>The device's absolute orientation gamma value ranges from 0 to 1.</p>",
    signatures: [
      {
        label: "absoluteOrientationGamma()",
        parameters: [],
      },
    ],
  },
  {
    name: "osc",
    detail: "Pattern.osc/external_io",
    documentation:
      '<p>Sends each hap as an OSC message, which can be picked up by SuperCollider or any other OSC-enabled software.\nFor more info, read <a href="https://strudel.cc/learn/input-output/">MIDI &amp; OSC in the docs</a></p>',
    signatures: [
      {
        label: "osc()",
        parameters: [],
      },
    ],
  },
  {
    name: "OLAProcessor",
    detail: "OLAProcessor",
    documentation: "",
    signatures: [
      {
        label: "OLAProcessor()",
        parameters: [],
      },
    ],
  },
  {
    name: "reallocateChannelsIfNeeded",
    detail: "OLAProcessor#reallocateChannelsIfNeeded/internals",
    documentation:
      "<p>Handles dynamic reallocation of input/output channels buffer\n(channel numbers may vary during lifecycle)</p>",
    signatures: [
      {
        label: "reallocateChannelsIfNeeded()",
        parameters: [],
      },
    ],
  },
  {
    name: "readInputs",
    detail: "OLAProcessor#readInputs/internals",
    documentation: "<p>Read next web audio block to input buffers</p>",
    signatures: [
      {
        label: "readInputs()",
        parameters: [],
      },
    ],
  },
  {
    name: "writeOutputs",
    detail: "OLAProcessor#writeOutputs/internals",
    documentation: "<p>Write next web audio block from output buffers</p>",
    signatures: [
      {
        label: "writeOutputs()",
        parameters: [],
      },
    ],
  },
  {
    name: "shiftInputBuffers",
    detail: "OLAProcessor#shiftInputBuffers/internals",
    documentation:
      "<p>Shift left content of input buffers to receive new web audio block</p>",
    signatures: [
      {
        label: "shiftInputBuffers()",
        parameters: [],
      },
    ],
  },
  {
    name: "shiftOutputBuffers",
    detail: "OLAProcessor#shiftOutputBuffers/internals",
    documentation:
      "<p>Shift left content of output buffers to receive new web audio block</p>",
    signatures: [
      {
        label: "shiftOutputBuffers()",
        parameters: [],
      },
    ],
  },
  {
    name: "prepareInputBuffersToSend",
    detail: "OLAProcessor#prepareInputBuffersToSend/internals",
    documentation:
      "<p>Copy contents of input buffers to buffer actually sent to process</p>",
    signatures: [
      {
        label: "prepareInputBuffersToSend()",
        parameters: [],
      },
    ],
  },
  {
    name: "handleOutputBuffersToRetrieve",
    detail: "OLAProcessor#handleOutputBuffersToRetrieve/internals",
    documentation:
      "<p>Add contents of output buffers just processed to output buffers</p>",
    signatures: [
      {
        label: "handleOutputBuffersToRetrieve()",
        parameters: [],
      },
    ],
  },
  {
    name: "generateReverb",
    detail: "reverbGen.generateReverb/internals",
    documentation: "<p>Generates a reverb impulse response.</p>",
    signatures: [
      {
        label: "generateReverb(params, callback)",
        parameters: [
          {
            label: "Object params",
            documentation: "<p>TODO: Document the properties.</p>",
          },
          {
            label: "function callback",
            documentation:
              "<p>Function to call when\nthe impulse response has been generated. The impulse response\nis passed to this function as its parameter. May be called\nimmediately within the current execution context, or later.</p>",
          },
        ],
      },
    ],
  },
  {
    name: "generateGraph",
    detail: "reverbGen.generateGraph/internals",
    documentation:
      "<p>Creates a canvas element showing a graph of the given data.</p>",
    signatures: [
      {
        label: "generateGraph(data, width, height, min, max)",
        parameters: [
          {
            label: "Float32Array data",
            documentation: "<p>An array of numbers, or a Float32Array.</p>",
          },
          {
            label: "number width",
            documentation: "<p>Width in pixels of the canvas.</p>",
          },
          {
            label: "number height",
            documentation: "<p>Height in pixels of the canvas.</p>",
          },
          {
            label: "number min",
            documentation:
              "<p>Minimum value of data for the graph (lower edge).</p>",
          },
          {
            label: "number max",
            documentation:
              "<p>Maximum value of data in the graph (upper edge).</p>",
          },
        ],
      },
    ],
  },
  {
    name: "applyGradualLowpass",
    detail: "applyGradualLowpass/internals",
    documentation:
      "<p>Applies a constantly changing lowpass filter to the given sound.</p>",
    signatures: [
      {
        label:
          "applyGradualLowpass(input, lpFreqStart, lpFreqEnd, lpFreqEndAt, callback)",
        parameters: [
          {
            label: "AudioBuffer input",
            documentation: "",
          },
          {
            label: "number lpFreqStart",
            documentation: "",
          },
          {
            label: "number lpFreqEnd",
            documentation: "",
          },
          {
            label: "number lpFreqEndAt",
            documentation: "",
          },
          {
            label: "function callback",
            documentation:
              "<p>May be called\nimmediately within the current execution context, or later.</p>",
          },
        ],
      },
    ],
  },
  {
    name: "getAllChannelData",
    detail: "getAllChannelData",
    documentation: "",
    signatures: [
      {
        label: "getAllChannelData(buffer)",
        parameters: [
          {
            label: "AudioBuffer buffer",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "randomSample",
    detail: "randomSample",
    documentation: "",
    signatures: [
      {
        label: "randomSample()",
        parameters: [],
      },
    ],
  },
  {
    name: "getDuration",
    detail: "getDuration/samples",
    documentation:
      "<p>Returns the duration, in seconds, of the given sample.\nHas optional param <code>n</code> (for instance, the <code>2</code> in <code>s(&quot;casio:2&quot;)</code>)</p>\n<p>Note: <code>must</code> be called with await, otherwise you'll get a pending Promise object.</p>",
    signatures: [
      {
        label: "getDuration(sampleName, (optional))",
        parameters: [
          {
            label: "string sampleName",
            documentation: "",
          },
          {
            label: "number (optional)",
            documentation: "<p>n</p>",
          },
        ],
      },
    ],
  },
  {
    name: "samples",
    detail: "samples/samples",
    documentation:
      "<p>Loads a collection of samples to use with <code>s</code></p>",
    signatures: [
      {
        label: "samples()",
        parameters: [],
      },
    ],
  },
  {
    name: "setMaxPolyphony",
    detail: "setMaxPolyphony/superdough",
    documentation:
      "<p>Set the max polyphony. If notes are ringing out via <code>release</code> then they will\nstart to die out in first-in-first-out order once the max polyphony has been hit</p>",
    signatures: [
      {
        label: "setMaxPolyphony(Max)",
        parameters: [
          {
            label: "number Max",
            documentation: "<p>polyphony. Defaults to 128</p>",
          },
        ],
      },
    ],
  },
  {
    name: "setGainCurve",
    detail: "setGainCurve/amplitude,superdough",
    documentation:
      "<p>Apply a function to all gains provided in patterns. Can be used to rescale gain to be\nquadratic, exponential, etc. rather than linear</p>",
    signatures: [
      {
        label: "setGainCurve(function)",
        parameters: [
          {
            label: "function function",
            documentation: "<p>to apply to all gain values</p>",
          },
        ],
      },
    ],
  },
  {
    name: "aliasBank",
    detail: "aliasBank/samples",
    documentation:
      "<p>Register an alias for a bank of sounds.\nOptionally accepts a single argument map of bank aliases.\nOptionally accepts a single argument string of a path to a JSON file containing bank aliases.</p>",
    signatures: [
      {
        label: "aliasBank(bank, alias)",
        parameters: [
          {
            label: "string bank",
            documentation: "<p>The bank to alias</p>",
          },
          {
            label: "string alias",
            documentation: "<p>The alias to use for the bank</p>",
          },
        ],
      },
    ],
  },
  {
    name: "soundAlias",
    detail: "soundAlias/samples",
    documentation: "<p>Register an alias for a sound.</p>",
    signatures: [
      {
        label: "soundAlias(original, alias)",
        parameters: [
          {
            label: "string original",
            documentation: "<p>The original sound name</p>",
          },
          {
            label: "string alias",
            documentation: "<p>The alias to use for the sound</p>",
          },
        ],
      },
    ],
  },
  {
    name: "pickAndRename",
    detail: "pickAndRename/internals",
    documentation:
      "<p>Selects entries from <code>source</code> and renames them via <code>map</code></p>",
    signatures: [
      {
        label: "pickAndRename()",
        parameters: [],
      },
    ],
  },
  {
    name: "tables",
    detail: "tables/wavetable",
    documentation:
      "<p>Loads a collection of wavetables to use with <code>s</code></p>",
    signatures: [
      {
        label: "tables()",
        parameters: [],
      },
    ],
  },
  {
    name: "applyHannWindow",
    detail: "PhaseVocoderProcessor#applyHannWindow/internals",
    documentation: "<p>Apply Hann window in-place</p>",
    signatures: [
      {
        label: "applyHannWindow()",
        parameters: [],
      },
    ],
  },
  {
    name: "computeMagnitudes",
    detail: "PhaseVocoderProcessor#computeMagnitudes/internals",
    documentation: "<p>Compute squared magnitudes for peak finding</p>",
    signatures: [
      {
        label: "computeMagnitudes()",
        parameters: [],
      },
    ],
  },
  {
    name: "findPeaks",
    detail: "PhaseVocoderProcessor#findPeaks/internals",
    documentation: "<p>Find peaks in spectrum magnitudes</p>",
    signatures: [
      {
        label: "findPeaks()",
        parameters: [],
      },
    ],
  },
  {
    name: "shiftPeaks",
    detail: "PhaseVocoderProcessor#shiftPeaks/internals",
    documentation:
      "<p>Shift peaks and regions of influence by pitchFactor into new specturm</p>",
    signatures: [
      {
        label: "shiftPeaks()",
        parameters: [],
      },
    ],
  },
  {
    name: "chyx",
    detail: "chyx/internals",
    documentation: "<p>BYTE BEATS</p>",
    signatures: [
      {
        label: "chyx()",
        parameters: [],
      },
    ],
  },
  {
    name: "transpose",
    detail: "Pattern.transpose/tonal",
    documentation:
      "<p>Change the pitch of each value by the given amount. Expects numbers or note strings as values.\nThe amount can be given as a number of semitones or as a string in interval short notation.\nIf you don't care about enharmonic correctness, just use numbers. Otherwise, pass the interval of\nthe form: ST where S is the degree number and T the type of interval with</p>\n<ul>\n<li>M = major</li>\n<li>m = minor</li>\n<li>P = perfect</li>\n<li>A = augmented</li>\n<li>d = diminished</li>\n</ul>\n<p>Examples intervals:</p>\n<ul>\n<li>1P = unison</li>\n<li>3M = major third</li>\n<li>3m = minor third</li>\n<li>4P = perfect fourth</li>\n<li>4A = augmented fourth</li>\n<li>5P = perfect fifth</li>\n<li>5d = diminished fifth</li>\n</ul>",
    signatures: [
      {
        label: "transpose(amount)",
        parameters: [
          {
            label: "string amount",
            documentation:
              "<p>Either number of semitones or interval string.</p>",
          },
        ],
      },
    ],
  },
  {
    name: "scaleTranspose",
    detail: "Pattern.scaleTranspose/tonal",
    documentation:
      "<p>Transposes notes inside the scale by the number of steps.\nExpected to be called on a Pattern which already has a {@link Pattern#scale}</p>",
    signatures: [
      {
        label: "scaleTranspose(offset)",
        parameters: [
          {
            label: "offset offset",
            documentation: "<p>number of steps inside the scale</p>",
          },
        ],
      },
    ],
  },
  {
    name: "scale",
    detail: "scale/tonal",
    documentation:
      "<p>Turns numbers into notes in the scale (zero indexed) or quantizes notes to a scale.</p>\n<p>When describing notes via numbers, note that negative numbers can be used to wrap backwards\nin the scale as well as sharps or flats to produce notes outside of the scale.</p>\n<p>Also sets scale for other scale operations, like {@link Pattern#scaleTranspose}.</p>\n<p>A scale consists of a root note (e.g. <code>c4</code>, <code>c</code>, <code>f#</code>, <code>bb4</code>) followed by semicolon (':') and then a <a href=\"https://github.com/tonaljs/tonal/blob/main/packages/scale-type/data.ts\">scale type</a>.</p>\n<p>The scale name must be written without spaces (because it would be interpreted as a multi-step pattern otherwise).\nIf your scale name includes spaces, replace them with colons.</p>\n<p>The root note defaults to octave 3, if no octave number is given.</p>",
    signatures: [
      {
        label: "scale(scale)",
        parameters: [
          {
            label: "string scale",
            documentation: "<p>Name of scale</p>",
          },
        ],
      },
    ],
  },
  {
    name: "addVoicings",
    detail: "Pattern.addVoicings/tonal",
    documentation: "<p>Adds a new custom voicing dictionary.</p>",
    signatures: [
      {
        label: "addVoicings(name, dictionary, range)",
        parameters: [
          {
            label: "string name",
            documentation: "<p>identifier for the voicing dictionary</p>",
          },
          {
            label: "Object dictionary",
            documentation: "<p>maps chord symbol to possible voicings</p>",
          },
          {
            label: "Array range",
            documentation: "<p>min, max note</p>",
          },
        ],
      },
    ],
  },
  {
    name: "voicings",
    detail: "Pattern.voicings/tonal",
    documentation:
      '<p>DEPRECATED: still works, but it is recommended you use .voicing instead (without s).\nTurns chord symbols into voicings, using the smoothest voice leading possible.\nUses <a href="https://github.com/felixroos/chord-voicings#chord-voicings">chord-voicings package</a>.</p>',
    signatures: [
      {
        label: "voicings(dictionary)",
        parameters: [
          {
            label: "string dictionary",
            documentation: "<p>which voicing dictionary to use.</p>",
          },
        ],
      },
    ],
  },
  {
    name: "rootNotes",
    detail: "Pattern.rootNotes/tonal",
    documentation:
      "<p>Maps the chords of the incoming pattern to root notes in the given octave.</p>",
    signatures: [
      {
        label: "rootNotes(octave)",
        parameters: [
          {
            label: "octave octave",
            documentation: "<p>octave to use</p>",
          },
        ],
      },
    ],
  },
  {
    name: "voicing",
    detail: "voicing/tonal",
    documentation:
      "<p>Turns chord symbols into voicings. You can use the following control params:</p>\n<ul>\n<li><code>chord</code>: Note, followed by chord symbol, e.g. C Am G7 Bb^7</li>\n<li><code>dict</code>: voicing dictionary to use, falls back to default dictionary</li>\n<li><code>anchor</code>: the note that is used to align the chord</li>\n<li><code>mode</code>: how the voicing is aligned to the anchor\n<ul>\n<li><code>below</code>: top note &lt;= anchor</li>\n<li><code>duck</code>: top note &lt;= anchor, anchor excluded</li>\n<li><code>above</code>: bottom note &gt;= anchor</li>\n<li><code>root</code>: bottom note is the lowest root of the chord &gt;= anchor</li>\n<li><code>oldabove</code> : old (buggy) behavior of above, kept for legacy reason</li>\n<li><code>oldroot</code> : old (buggy) behavior of root, kept for legacy reason</li>\n</ul>\n</li>\n<li><code>offset</code>: whole number that shifts the voicing up or down to the next voicing</li>\n<li><code>n</code>: if set, the voicing is played like a scale. Overshooting numbers will be octaved</li>\n</ul>\n<p>All of the above controls are optional, except <code>chord</code>.\nIf you pass a pattern of strings to voicing, they will be interpreted as chords.</p>",
    signatures: [
      {
        label: "voicing()",
        parameters: [],
      },
    ],
  },
  {
    name: "fscope",
    detail: "fscope/visualization",
    documentation:
      "<p>Renders an oscilloscope for the frequency domain of the audio signal.</p>",
    signatures: [
      {
        label: "fscope(color, scale, pos, lean, min, max)",
        parameters: [
          {
            label: "string color",
            documentation:
              "<p>line color as hex or color name. defaults to white.</p>",
          },
          {
            label: "number scale",
            documentation: "<p>scales the y-axis. Defaults to 0.25</p>",
          },
          {
            label: "number pos",
            documentation:
              "<p>y-position relative to screen height. 0 = top, 1 = bottom of screen</p>",
          },
          {
            label: "number lean",
            documentation:
              "<p>y-axis alignment where 0 = top and 1 = bottom</p>",
          },
          {
            label: "number min",
            documentation: "<p>min value</p>",
          },
          {
            label: "number max",
            documentation: "<p>max value</p>",
          },
        ],
      },
    ],
  },
  {
    name: "scope",
    detail: "scope/visualization",
    documentation:
      "<p>Renders an oscilloscope for the time domain of the audio signal.</p>",
    signatures: [
      {
        label: "scope(config, align, color, thickness, scale, pos, trigger)",
        parameters: [
          {
            label: "object config",
            documentation: "<p>optional config with options:</p>",
          },
          {
            label: "boolean align",
            documentation:
              "<p>if 1, the scope will be aligned to the first zero crossing. defaults to 1</p>",
          },
          {
            label: "string color",
            documentation:
              "<p>line color as hex or color name. defaults to white.</p>",
          },
          {
            label: "number thickness",
            documentation: "<p>line thickness. defaults to 3</p>",
          },
          {
            label: "number scale",
            documentation: "<p>scales the y-axis. Defaults to 0.25</p>",
          },
          {
            label: "number pos",
            documentation:
              "<p>y-position relative to screen height. 0 = top, 1 = bottom of screen</p>",
          },
          {
            label: "number trigger",
            documentation:
              "<p>amplitude value that is used to align the scope. defaults to 0.</p>",
          },
        ],
      },
    ],
  },
  {
    name: "spectrum",
    detail: "spectrum/visualization",
    documentation:
      "<p>Renders a spectrum analyzer for the incoming audio signal.</p>",
    signatures: [
      {
        label: "spectrum(config, thickness, speed, min, max)",
        parameters: [
          {
            label: "object config",
            documentation: "<p>optional config with options:</p>",
          },
          {
            label: "integer thickness",
            documentation: "<p>line thickness in px (default 3)</p>",
          },
          {
            label: "integer speed",
            documentation: "<p>scroll speed (default 1)</p>",
          },
          {
            label: "integer min",
            documentation: "<p>min db (default -80)</p>",
          },
          {
            label: "integer max",
            documentation: "<p>max db (default 0)</p>",
          },
        ],
      },
    ],
  },
  {
    name: "tune",
    detail: "Pattern.tune/tonal",
    documentation:
      "<p>Deprecated.</p>\n<p>Assumes pattern contains numerical scale degrees on the <code>i</code> control (see examples below). Accepts a scale name or list of frequencies (see all available names at the link on the reference). Returns a new pattern with all values mapped to a frequency ratio. Similar to <code>xen</code>.</p>",
    signatures: [
      {
        label: "tune(scale)",
        parameters: [
          {
            label: "string scale",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "xen",
    detail: "Pattern.xen/tonal",
    documentation:
      "<p>Assumes a numerical pattern of scale steps, and a scale. Scales accepted are all preset scale names of <code>tune</code>, arbitrary edos such as 31edo, or an array of frequency ratios. Assumes scales repeat at octave (2/1). Returns a new pattern with all values mapped to their associated frequency, assuming a base frequency of 220hz. See first 4 examples for the different ways you can input a scale into <code>xen</code></p>",
    signatures: [
      {
        label: "xen(scaleNameOrRatios)",
        parameters: [
          {
            label: "string scaleNameOrRatios",
            documentation: "",
          },
        ],
      },
    ],
  },
  {
    name: "withBase",
    detail: "withBase/tonal",
    documentation:
      "<p>Assumes pattern of frequencies tuned to some <code>base</code> frequency, such as the output of <code>xen</code>\nBecause <code>xen</code> defaults to <code>220Hz</code>, so will <code>withBase</code>.\nbut you can specify a different original base with the standard optional array syntax '<code>:</code>'</p>",
    signatures: [
      {
        label: "withBase(base, (optional))",
        parameters: [
          {
            label: "number base",
            documentation: "",
          },
          {
            label: "number (optional)",
            documentation: "<p>originalBase</p>",
          },
        ],
      },
    ],
  },
  {
    name: "ftranspose",
    detail: "ftranspose/tonal",
    documentation:
      "<p>Frequency transpose. Assumes pattern either has <code>freq</code> set, or has values that can be interpreted as frequencies\namt has optional <code>edoSize</code> param, defaults to 12.\nIf haps have edoSize param set, such as from the output of <code>xen(&quot;31edo&quot;)</code>,\n<code>ftrans</code> will fallback to that instead of 12 as the default.</p>\n<p>Transposes the frequency by <code>amt</code> edoSteps</p>",
    signatures: [
      {
        label: "ftranspose(amt, edoSize)",
        parameters: [
          {
            label: "number amt",
            documentation: "",
          },
          {
            label: "number edoSize",
            documentation: "<p>(optional)</p>",
          },
        ],
      },
    ],
  },
];

// Common typos and their corrections
const TYPO_CORRECTIONS: Record<string, string> = {
  // Sample typos
  db: "bd",
  ds: "sd",
  kick: "bd",
  snare: "sd",
  hihat: "hh",
  openhat: "oh",
  clap: "cp",
  cowbell: "cb",
  crash: "cr",
  ride: "rd",
  // Note typos
  cf: "c",
  ef: "e",
  bf: "b",
  // Function typos
  sounds: "sound",
  notes: "note",
  filters: "lpf",
  lowpass: "lpf",
  highpass: "hpf",
  bandpass: "bpf",
  reverb: "room",
  echo: "delay",
  volume: "gain",
  reverse: "rev",
};

/**
 * Get all available samples (dynamic + defaults merged)
 * Always includes default samples as a baseline, adds dynamic samples on top
 */
function getAllSamples(): string[] {
  if (dynamicSamples.length > 0) {
    // Merge defaults with dynamic, removing duplicates
    const combined = new Set([...DEFAULT_SAMPLE_NAMES, ...dynamicSamples]);
    return Array.from(combined);
  }
  return DEFAULT_SAMPLE_NAMES;
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Find similar words for typo suggestions
 */
function findSimilar(
  word: string,
  candidates: string[],
  maxDistance = 2,
): string[] {
  const lowerWord = word.toLowerCase();

  // Check explicit typo corrections first
  if (TYPO_CORRECTIONS[lowerWord]) {
    return [TYPO_CORRECTIONS[lowerWord]];
  }

  // Find candidates within edit distance
  const similar: { word: string; distance: number }[] = [];
  for (const candidate of candidates) {
    const distance = levenshtein(lowerWord, candidate.toLowerCase());
    if (distance <= maxDistance && distance > 0) {
      similar.push({ word: candidate, distance });
    }
  }

  // Sort by distance and return top matches
  return similar
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3)
    .map((s) => s.word);
}

/**
 * Mini-notation parse result
 */
interface MiniParseResult {
  success: boolean;
  leaves?: Array<{
    type_: string;
    source_: string;
    location_: {
      start: { offset: number; line: number; column: number };
      end: { offset: number; line: number; column: number };
    };
  }>;
  error?: {
    message: string;
    location?: {
      start: { offset: number; line: number; column: number };
      end: { offset: number; line: number; column: number };
    };
    expected?: string[];
    found?: string;
  };
}

/**
 * Parse mini-notation using @strudel/mini parser
 * The parser expects the string WITH quotes, so we add them
 */
function parseMiniNotation(content: string): MiniParseResult {
  // Wrap content in quotes for the parser (it expects the full quoted string)
  const quotedContent = `"${content.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

  try {
    // Use parse() directly to get the PEG.js error with location if it fails
    parseMini(quotedContent);

    // If parse succeeded, get the leaves (atoms) for further analysis
    const leaves = getMiniLeaves(quotedContent);
    return { success: true, leaves };
  } catch (e: any) {
    // Check if it's a PEG.js SyntaxError with location
    if (e && e.location) {
      return {
        success: false,
        error: {
          message: e.message,
          location: e.location,
          expected: e.expected?.map((exp: any) => {
            if (exp.type === "literal") return `'${exp.text}'`;
            if (exp.description) return exp.description;
            return String(exp);
          }),
          found: e.found,
        },
      };
    }

    // Try to extract location from error message: "[mini] parse error at line X column Y:"
    const locMatch = e.message?.match(/line (\d+)(?: column (\d+))?/);
    if (locMatch) {
      const line = parseInt(locMatch[1], 10);
      const column = locMatch[2] ? parseInt(locMatch[2], 10) : 1;
      return {
        success: false,
        error: {
          message: e.message.replace(
            /^\[mini\] parse error at line \d+(?: column \d+)?:\s*/,
            "",
          ),
          location: {
            start: { offset: 0, line, column },
            end: { offset: 0, line, column: column + 1 },
          },
        },
      };
    }

    // Generic error
    return {
      success: false,
      error: { message: e.message || "Unknown parse error" },
    };
  }
}

// Store diagnostics with their data for code actions
interface DiagnosticData {
  type: "unknown_sample" | "unbalanced_bracket" | "unknown_function";
  word?: string;
  suggestions?: string[];
}

const diagnosticDataMap = new Map<string, Map<string, DiagnosticData>>();

connection.onInitialize((params: InitializeParams): InitializeResult => {
  connection.console.log("Strudel LSP initializing...");

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        triggerCharacters: ['"', "'", " ", ":", "(", ".", ","],
        resolveProvider: true,
      },
      hoverProvider: true,
      signatureHelpProvider: {
        triggerCharacters: ["(", ","],
        retriggerCharacters: [","],
      },
      codeActionProvider: {
        codeActionKinds: [CodeActionKind.QuickFix],
      },
    },
  };
});

connection.onInitialized(() => {
  connection.console.log("Strudel LSP initialized");

  // Connect to engine and load samples
  connectToEngine();
});

/**
 * TCP client state for engine connection
 */
let engineSocket: import("net").Socket | null = null;
let engineBuffer = "";
let stopWatching: (() => void) | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;

/**
 * Connect to the engine via TCP and request samples
 * Uses state file to get connection info, watches for engine restarts
 */
async function connectToEngine() {
  const net = await import("net");
  const { readEngineState, watchEngineState, isEngineRunning } =
    await import("./engine-state.js");

  // Function to attempt connection
  const tryConnect = (state: { port: number; pid: number }) => {
    if (engineSocket) {
      engineSocket.destroy();
      engineSocket = null;
    }

    connection.console.log(`Connecting to engine on port ${state.port}...`);

    const socket = net.createConnection(
      { port: state.port, host: "127.0.0.1" },
      () => {
        connection.console.log("Connected to engine");
        engineSocket = socket;

        // Request samples, banks, and sounds
        socket.write(JSON.stringify({ type: "getSamples" }) + "\n");
        socket.write(JSON.stringify({ type: "getBanks" }) + "\n");
        socket.write(JSON.stringify({ type: "getSounds" }) + "\n");
      },
    );

    socket.on("data", (data) => {
      engineBuffer += data.toString();

      // Process newline-delimited JSON messages
      let newlineIndex;
      while ((newlineIndex = engineBuffer.indexOf("\n")) !== -1) {
        const line = engineBuffer.slice(0, newlineIndex);
        engineBuffer = engineBuffer.slice(newlineIndex + 1);

        if (line.trim()) {
          try {
            const msg = JSON.parse(line);
            handleEngineMessage(msg);
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    });

    socket.on("error", (err) => {
      connection.console.log(`Engine connection error: ${err.message}`);
      engineSocket = null;
    });

    socket.on("close", () => {
      connection.console.log("Engine connection closed");
      engineSocket = null;
      engineBuffer = "";
    });
  };

  // Handle messages from engine
  const handleEngineMessage = (msg: any) => {
    switch (msg.type) {
      case "samples":
        dynamicSamples = msg.samples || [];
        connection.console.log(
          `Received ${dynamicSamples.length} samples from engine`,
        );
        // Re-validate all open documents
        documents.all().forEach((doc) => validateDocument(doc));
        break;
      case "banks":
        dynamicBanks = msg.banks || [];
        connection.console.log(
          `Received ${dynamicBanks.length} banks from engine`,
        );
        // Re-validate all open documents
        documents.all().forEach((doc) => validateDocument(doc));
        break;
      case "sounds":
        // Could store synth sounds too if needed
        connection.console.log(
          `Received ${msg.sounds?.length || 0} sounds from engine`,
        );
        break;
    }
  };

  // Initial connection attempt
  const state = readEngineState();
  if (state && isEngineRunning(state) && state.port > 0) {
    tryConnect(state);
  } else {
    connection.console.log("Engine not running, waiting for it to start...");
  }

  // Watch for engine starting/restarting
  stopWatching = watchEngineState((newState) => {
    if (newState && isEngineRunning(newState) && newState.port > 0) {
      // Clear any pending reconnect
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }

      // Small delay to let engine fully initialize
      reconnectTimer = setTimeout(() => {
        tryConnect(newState);
      }, 500);
    } else if (!newState) {
      connection.console.log("Engine stopped");
      if (engineSocket) {
        engineSocket.destroy();
        engineSocket = null;
      }
    }
  });
}

/**
 * Find if position is inside a mini-notation string (inside quotes)
 */
function findMiniNotationContext(
  document: TextDocument,
  position: Position,
): { inMini: boolean; content: string; startOffset: number } | null {
  const text = document.getText();
  const offset = document.offsetAt(position);

  // Look backwards for opening quote
  let quoteStart = -1;
  let quoteChar = "";
  for (let i = offset - 1; i >= 0; i--) {
    const char = text[i];
    if (char === '"' || char === "'") {
      // Check if escaped
      if (i > 0 && text[i - 1] === "\\") continue;
      quoteStart = i;
      quoteChar = char;
      break;
    }
    // Stop at newline or semicolon (likely not in same string)
    if (char === "\n" || char === ";") break;
  }

  if (quoteStart === -1) return null;

  // Look forward for closing quote
  let quoteEnd = -1;
  for (let i = offset; i < text.length; i++) {
    const char = text[i];
    if (char === quoteChar) {
      // Check if escaped
      if (i > 0 && text[i - 1] === "\\") continue;
      quoteEnd = i;
      break;
    }
    if (char === "\n") break;
  }

  if (quoteEnd === -1) return null;

  const content = text.slice(quoteStart + 1, quoteEnd);
  return { inMini: true, content, startOffset: quoteStart + 1 };
}

/**
 * Get current word at position
 */
function getCurrentWord(text: string, offset: number): string {
  let start = offset;
  let end = offset;

  // Go backwards to find word start
  while (start > 0 && /[a-zA-Z0-9_]/.test(text[start - 1])) {
    start--;
  }

  // Go forward to find word end
  while (end < text.length && /[a-zA-Z0-9_]/.test(text[end])) {
    end++;
  }

  return text.slice(start, end);
}

/**
 * Find function call context at position
 */
function findFunctionContext(
  text: string,
  offset: number,
): { name: string; paramIndex: number } | null {
  let depth = 0;
  let paramIndex = 0;

  // Go backwards to find function name
  for (let i = offset - 1; i >= 0; i--) {
    const char = text[i];

    if (char === ")") {
      depth++;
    } else if (char === "(") {
      if (depth === 0) {
        // Found opening paren, now find function name
        let nameEnd = i;
        let nameStart = i - 1;
        while (nameStart >= 0 && /[a-zA-Z0-9_]/.test(text[nameStart])) {
          nameStart--;
        }
        nameStart++;

        if (nameStart < nameEnd) {
          const name = text.slice(nameStart, nameEnd);
          return { name, paramIndex };
        }
        return null;
      }
      depth--;
    } else if (char === "," && depth === 0) {
      paramIndex++;
    } else if (char === "\n" || char === ";") {
      break;
    }
  }

  return null;
}

connection.onCompletion((params): CompletionItem[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  const text = document.getText();
  const offset = document.offsetAt(params.position);

  // Check if we're inside a mini-notation string
  const miniContext = findMiniNotationContext(document, params.position);

  const items: CompletionItem[] = [];

  if (miniContext?.inMini) {
    // Inside mini-notation - suggest samples and notes
    const localOffset = offset - miniContext.startOffset;
    const beforeCursor = miniContext.content.slice(0, localOffset);

    // Check if after a colon (sample index)
    if (beforeCursor.endsWith(":")) {
      // Suggest sample indices
      for (let i = 0; i < 16; i++) {
        items.push({
          label: String(i),
          kind: CompletionItemKind.Value,
          detail: `Sample variant ${i}`,
          sortText: String(i).padStart(2, "0"),
        });
      }
      return items;
    }

    // Suggest samples
    const samples = getAllSamples();
    for (const sample of samples) {
      items.push({
        label: sample,
        kind: CompletionItemKind.Value,
        detail: "Sample",
        documentation: `Play ${sample} sound`,
      });
    }

    // Suggest notes with octaves
    for (const note of NOTE_NAMES) {
      for (const octave of OCTAVES) {
        items.push({
          label: `${note}${octave}`,
          kind: CompletionItemKind.Value,
          detail: "Note",
          documentation: `Note ${note.toUpperCase()}${octave}`,
          sortText: `1${note}${octave}`, // Sort notes after samples
        });
      }
    }

    // Suggest mini-notation operators
    for (const op of MINI_OPERATORS) {
      items.push({
        label: op.label,
        kind: CompletionItemKind.Operator,
        detail: op.detail,
        documentation: op.documentation,
        sortText: `2${op.label}`, // Sort operators last
      });
    }
  } else {
    // Outside mini-notation - suggest Strudel functions

    // Check if we're after a dot (method call)
    const beforeCursor = text.slice(Math.max(0, offset - 50), offset);
    const afterDot = beforeCursor.match(/\.\s*([a-zA-Z]*)$/);

    for (const func of STRUDEL_FUNCTIONS) {
      items.push({
        label: func.name,
        kind: CompletionItemKind.Function,
        detail: func.detail,
        documentation: {
          kind: MarkupKind.Markdown,
          value: `${func.documentation}\n\n\`\`\`javascript\n${func.signatures[0].label}\n\`\`\``,
        },
        insertText: afterDot ? `${func.name}($1)` : `${func.name}($1)`,
        insertTextFormat: 2, // Snippet
      });
    }

    // Suggest scales
    for (const scale of SCALE_NAMES) {
      items.push({
        label: scale,
        kind: CompletionItemKind.Enum,
        detail: "Scale",
        documentation: `${scale} scale`,
      });
    }

    // Suggest banks if typing .bank(
    if (beforeCursor.includes(".bank(")) {
      const banks =
        dynamicBanks.length > 0
          ? dynamicBanks
          : ["RolandTR808", "RolandTR909", "RolandTR707"];
      for (const bank of banks) {
        items.push({
          label: bank,
          kind: CompletionItemKind.Module,
          detail: "Sample bank",
          documentation: `Use ${bank} drum machine samples`,
        });
      }
    }
  }

  return items;
});

connection.onCompletionResolve((item): CompletionItem => {
  // Add more detail on resolve if needed
  return item;
});

connection.onSignatureHelp((params): SignatureHelp | null => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const text = document.getText();
  const offset = document.offsetAt(params.position);

  // Find function context
  const funcContext = findFunctionContext(text, offset);
  if (!funcContext) return null;

  // Find matching function
  const func = STRUDEL_FUNCTIONS.find((f) => f.name === funcContext.name);
  if (!func) return null;

  // Build signature help
  const signatures: SignatureInformation[] = func.signatures.map((sig) => {
    const params: ParameterInformation[] = sig.parameters.map((p) => ({
      label: p.label,
      documentation: {
        kind: MarkupKind.Markdown,
        value: p.documentation,
      },
    }));

    return {
      label: sig.label,
      documentation: sig.documentation || func.documentation,
      parameters: params,
    };
  });

  // Select best signature based on parameter count
  let activeSignature = 0;
  for (let i = 0; i < func.signatures.length; i++) {
    if (func.signatures[i].parameters.length > funcContext.paramIndex) {
      activeSignature = i;
      break;
    }
  }

  return {
    signatures,
    activeSignature,
    activeParameter: Math.min(
      funcContext.paramIndex,
      func.signatures[activeSignature]?.parameters.length - 1 || 0,
    ),
  };
});

connection.onHover((params): Hover | null => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const text = document.getText();
  const offset = document.offsetAt(params.position);
  const word = getCurrentWord(text, offset);

  if (!word) return null;

  const samples = getAllSamples();

  // Check samples
  if (samples.includes(word)) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: `**${word}** - Sample\n\nPlay the ${word} sound.\n\n\`\`\`javascript\ns("${word}")\n\`\`\``,
      },
    };
  }

  // Check notes (strip octave)
  const noteBase = word.replace(/[0-9]/g, "");
  if (NOTE_NAMES.includes(noteBase)) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: `**${word}** - Note\n\nMusical note ${noteBase.toUpperCase()}${word.replace(/[^0-9]/g, "")}.\n\n\`\`\`javascript\nnote("${word}")\n\`\`\``,
      },
    };
  }

  // Check functions
  const func = STRUDEL_FUNCTIONS.find((f) => f.name === word);
  if (func) {
    const sigExamples = func.signatures.map((s) => s.label).join("\n");
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: `**${func.name}** - ${func.detail}\n\n${func.documentation}\n\n\`\`\`javascript\n${sigExamples}\n\`\`\``,
      },
    };
  }

  // Check scales
  if (SCALE_NAMES.includes(word)) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: `**${word}** - Scale\n\nMusical scale.\n\n\`\`\`javascript\n.scale("${word}")\n\`\`\``,
      },
    };
  }

  // Check mini operators
  const op = MINI_OPERATORS.find(
    (o) => o.label === word || o.label.includes(word),
  );
  if (op) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: `**${op.label}** - ${op.detail}\n\n${op.documentation}`,
      },
    };
  }

  // Check banks
  if (dynamicBanks.includes(word)) {
    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: `**${word}** - Sample Bank\n\nDrum machine sample bank.\n\n\`\`\`javascript\n.bank("${word}")\n\`\`\``,
      },
    };
  }

  return null;
});

/**
 * Validate document and produce diagnostics
 */
async function validateDocument(document: TextDocument): Promise<void> {
  const text = document.getText();
  const diagnostics: Diagnostic[] = [];
  const docData = new Map<string, DiagnosticData>();

  const samples = getAllSamples();
  const functionNames = STRUDEL_FUNCTIONS.map((f) => f.name);

  // Find user-defined functions created with register()
  // Pattern: register('name', ...) or register("name", ...)
  const userDefinedFunctions: string[] = [];
  const registerRegex = /\bregister\s*\(\s*(['"])(\w+)\1/g;
  let registerMatch;
  while ((registerMatch = registerRegex.exec(text)) !== null) {
    userDefinedFunctions.push(registerMatch[2]);
  }

  // Also look for const assignments that look like custom functions
  // Pattern: const funcName = register(...)
  const constRegisterRegex = /\bconst\s+(\w+)\s*=\s*register\s*\(/g;
  while ((registerMatch = constRegisterRegex.exec(text)) !== null) {
    userDefinedFunctions.push(registerMatch[1]);
  }

  // Combine built-in functions with user-defined ones for validation
  const allFunctionNames = [...functionNames, ...userDefinedFunctions];

  // Find all quoted strings and validate mini-notation
  const stringRegex = /(['"])((?:\\.|(?!\1)[^\\])*)\1/g;
  let match;

  // Functions whose string arguments should NOT be validated as mini-notation samples
  // These take bank names, scale names, function names, property names, or other non-sample identifiers
  const nonSampleArgFunctions = [
    "bank",
    "scale",
    "mode",
    "voicing",
    "chord",
    "struct",
    "mask",
    "register",
    "pull",
  ];

  while ((match = stringRegex.exec(text)) !== null) {
    const content = match[2];
    const stringStartOffset = match.index; // Position of opening quote
    const contentStartOffset = match.index + 1; // Skip opening quote

    // Skip empty strings
    if (!content.trim()) continue;

    // Skip strings that look like paths or URLs
    if (
      content.includes("/") &&
      (content.startsWith("http") ||
        content.startsWith(".") ||
        content.startsWith("github:"))
    )
      continue;

    // Skip strings that are clearly not mini-notation (contain common code patterns)
    if (
      content.includes("function") ||
      content.includes("=>") ||
      content.includes("return")
    )
      continue;

    // Check if this string is an argument to a function that doesn't take sample names
    // Look backwards from the quote to find the function call pattern: .funcName( or funcName(
    const beforeString = text.slice(
      Math.max(0, stringStartOffset - 50),
      stringStartOffset,
    );
    const funcCallMatch = beforeString.match(/\.?(\w+)\s*\(\s*$/);
    if (funcCallMatch && nonSampleArgFunctions.includes(funcCallMatch[1])) {
      // This is an argument to bank(), scale(), etc. - skip sample validation
      continue;
    }

    // Parse using @strudel/mini for proper AST-based validation
    const parseResult = parseMiniNotation(content);

    if (!parseResult.success && parseResult.error) {
      // Report parser error with accurate location
      const error = parseResult.error;

      // Calculate position in document
      // Parser location is 1-indexed and includes the quote we added, so subtract 1 from column
      let errorOffset: number;
      if (error.location) {
        // Parser offset includes the quote char we wrapped, so subtract 1
        // But we want to point to the document position, so use contentStartOffset
        errorOffset =
          contentStartOffset + Math.max(0, error.location.start.offset - 1);
      } else {
        errorOffset = contentStartOffset;
      }

      const pos = document.positionAt(errorOffset);
      const endOffset = error.location
        ? contentStartOffset + Math.max(0, error.location.end.offset - 1)
        : errorOffset + 1;
      const endPos = document.positionAt(
        Math.min(endOffset, stringStartOffset + match[0].length - 1),
      );

      const range = Range.create(pos, endPos);
      const key = `${range.start.line}:${range.start.character}`;

      // Clean up the error message
      let message = error.message;
      if (error.expected && error.found !== undefined) {
        const expectedStr = error.expected.slice(0, 5).join(", ");
        const more =
          error.expected.length > 5
            ? `, ... (${error.expected.length - 5} more)`
            : "";
        message = `Syntax error: expected ${expectedStr}${more} but found ${error.found === null ? "end of input" : `'${error.found}'`}`;
      }

      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range,
        message,
        source: "strudel",
        code: "parse-error",
      });

      docData.set(key, { type: "unbalanced_bracket" });
    }

    // If parsing succeeded, validate the leaves (atoms) for unknown samples
    if (parseResult.success && parseResult.leaves) {
      for (const leaf of parseResult.leaves) {
        if (leaf.type_ !== "atom") continue;

        const word = leaf.source_;

        // Skip if it looks like a note (with or without octave)
        if (/^[a-g][sb]?[0-9]?$/i.test(word)) continue;

        // Skip numbers and rests
        if (/^[0-9.-]+$/.test(word) || word === "~") continue;

        // Skip if it's a known sample
        if (samples.some((s) => s.toLowerCase() === word.toLowerCase()))
          continue;

        // Skip if it's a known bank (banks can appear as sample prefixes)
        if (dynamicBanks.some((b) => b.toLowerCase() === word.toLowerCase()))
          continue;

        // Skip common mini-notation atoms
        if (["x", "t", "f", "r", "-", "_"].includes(word.toLowerCase()))
          continue;

        // Skip if it looks like a variable reference
        if (/^[A-Z]/.test(word)) continue;

        // Skip voicing modes (used with .mode() like "above:c3", "below:c4")
        if (VOICING_MODES.includes(word.toLowerCase())) continue;

        // Skip scale names (used with .scale())
        if (SCALE_NAMES.includes(word.toLowerCase())) continue;

        // Calculate position in document
        // leaf.location_.start.offset is relative to the quoted string, subtract 1 for the quote we added
        const wordOffset =
          contentStartOffset + Math.max(0, leaf.location_.start.offset - 1);
        const wordEndOffset =
          contentStartOffset + Math.max(0, leaf.location_.end.offset - 1);

        const pos = document.positionAt(wordOffset);
        const endPos = document.positionAt(wordEndOffset);
        const range = Range.create(pos, endPos);
        const key = `${range.start.line}:${range.start.character}`;

        // Find similar samples for suggestion
        const suggestions = findSimilar(word, samples);

        const diagnostic: Diagnostic = {
          severity:
            suggestions.length > 0
              ? DiagnosticSeverity.Warning
              : DiagnosticSeverity.Hint,
          range,
          message:
            suggestions.length > 0
              ? `Unknown sample '${word}'. Did you mean: ${suggestions.join(", ")}?`
              : `Unknown sample '${word}' (may work if loaded dynamically)`,
          source: "strudel",
          code: "unknown-sample",
        };

        diagnostics.push(diagnostic);
        docData.set(key, { type: "unknown_sample", word, suggestions });
      }
    } else if (!parseResult.success) {
      // Fallback: if parsing failed, still try to identify unknown samples with simple regex
      // This helps users even when there are syntax errors
      const words = content
        .split(/[\s\[\]\{\}\(\)<>:*\/!?@~,|]+/)
        .filter((w) => w && !/^[0-9.-]+$/.test(w));
      for (const word of words) {
        // Skip if it looks like a note
        if (/^[a-g][sb]?[0-9]?$/i.test(word)) continue;
        // Skip if it's a known sample
        if (samples.some((s) => s.toLowerCase() === word.toLowerCase()))
          continue;
        // Skip if it's a known bank
        if (dynamicBanks.some((b) => b.toLowerCase() === word.toLowerCase()))
          continue;
        // Skip common words/operators
        if (["x", "t", "f", "r", "-", "_"].includes(word.toLowerCase()))
          continue;
        // Skip if it looks like a variable reference
        if (/^[A-Z]/.test(word)) continue;
        // Skip voicing modes and scale names
        if (VOICING_MODES.includes(word.toLowerCase())) continue;
        if (SCALE_NAMES.includes(word.toLowerCase())) continue;

        // Find position of this word in content
        const wordIndex = content.indexOf(word);
        if (wordIndex !== -1) {
          const pos = document.positionAt(contentStartOffset + wordIndex);
          const range = Range.create(
            pos,
            Position.create(pos.line, pos.character + word.length),
          );
          const key = `${range.start.line}:${range.start.character}`;

          // Skip if we already reported this location
          if (docData.has(key)) continue;

          // Find similar samples for suggestion
          const suggestions = findSimilar(word, samples);

          const diagnostic: Diagnostic = {
            severity:
              suggestions.length > 0
                ? DiagnosticSeverity.Warning
                : DiagnosticSeverity.Hint,
            range,
            message:
              suggestions.length > 0
                ? `Unknown sample '${word}'. Did you mean: ${suggestions.join(", ")}?`
                : `Unknown sample '${word}' (may work if loaded dynamically)`,
            source: "strudel",
            code: "unknown-sample",
          };

          diagnostics.push(diagnostic);
          docData.set(key, { type: "unknown_sample", word, suggestions });
        }
      }
    }
  }

  // Check function calls outside strings
  const funcCallRegex = /\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
  while ((match = funcCallRegex.exec(text)) !== null) {
    const funcName = match[1];
    const funcStart = match.index + 1; // After the dot

    // Skip if known function (built-in or user-defined)
    if (allFunctionNames.includes(funcName)) continue;
    // Skip common method names
    if (
      [
        "then",
        "catch",
        "map",
        "filter",
        "forEach",
        "reduce",
        "log",
        "error",
        "warn",
      ].includes(funcName)
    )
      continue;

    const suggestions = findSimilar(funcName, functionNames);

    if (suggestions.length > 0) {
      const pos = document.positionAt(funcStart);
      const range = Range.create(
        pos,
        Position.create(pos.line, pos.character + funcName.length),
      );
      const key = `${range.start.line}:${range.start.character}`;

      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range,
        message: `Unknown function '${funcName}'. Did you mean: ${suggestions.join(", ")}?`,
        source: "strudel",
        code: "unknown-function",
      });

      docData.set(key, {
        type: "unknown_function",
        word: funcName,
        suggestions,
      });
    }
  }

  diagnosticDataMap.set(document.uri, docData);
  connection.sendDiagnostics({ uri: document.uri, diagnostics });
}

connection.onCodeAction((params: CodeActionParams): CodeAction[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  const actions: CodeAction[] = [];
  const docData = diagnosticDataMap.get(document.uri);

  for (const diagnostic of params.context.diagnostics) {
    if (diagnostic.source !== "strudel") continue;

    const key = `${diagnostic.range.start.line}:${diagnostic.range.start.character}`;
    const data = docData?.get(key);

    if (data?.suggestions && data.suggestions.length > 0) {
      for (const suggestion of data.suggestions) {
        actions.push({
          title: `Replace with '${suggestion}'`,
          kind: CodeActionKind.QuickFix,
          diagnostics: [diagnostic],
          isPreferred: data.suggestions.indexOf(suggestion) === 0,
          edit: {
            changes: {
              [params.textDocument.uri]: [
                TextEdit.replace(diagnostic.range, suggestion),
              ],
            },
          },
        });
      }
    }
  }

  return actions;
});

// Validate on open and change
documents.onDidOpen((event) => {
  validateDocument(event.document);
});

documents.onDidChangeContent((event) => {
  validateDocument(event.document);
});

documents.onDidClose((event) => {
  diagnosticDataMap.delete(event.document.uri);
});

// Cleanup on shutdown
connection.onShutdown(() => {
  if (stopWatching) {
    stopWatching();
    stopWatching = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (engineSocket) {
    engineSocket.destroy();
    engineSocket = null;
  }
});

// Make the text document manager listen on the connection
documents.listen(connection);

// Listen on the connection
connection.listen();

console.error("[strudel-lsp] Server started");

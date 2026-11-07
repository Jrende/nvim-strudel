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
      "Overrides the css of highlighted events. Make sure to use single quotes!",
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
      "Displays a slider widget to allow the user manipulate a value",
    signatures: [
      {
        label: "slider(value, min, max, step)",
        parameters: [
          {
            label: "number value",
            documentation: "Initial value",
          },
          {
            label: "number min",
            documentation: "Minimum value - optional, defaults to 0",
          },
          {
            label: "number max",
            documentation: "Maximum value - optional, defaults to 1",
          },
          {
            label: "number step",
            documentation: "Step size - optional",
          },
        ],
      },
    ],
  },
  {
    name: "s",
    detail: "s/superdough,samples",
    documentation:
      "Select a sound / sample by name. When using mininotation, you can also\noptionally supply 'n' and 'gain' parameters separated by ':'.",
    signatures: [
      {
        label: "s(sound)",
        parameters: [
          {
            label: "string sound",
            documentation: "The sound / pattern of sounds to pick",
          },
        ],
      },
    ],
  },
  {
    name: "wt",
    detail: "wt/wavetable,superdough",
    documentation: "Position in the wavetable of the wavetable oscillator",
    signatures: [
      {
        label: "wt(position)",
        parameters: [
          {
            label: "number position",
            documentation: "Position in the wavetable from 0 to 1",
          },
        ],
      },
    ],
  },
  {
    name: "wtenv",
    detail: "wtenv/wavetable,envelope,superdough",
    documentation:
      "Amount of envelope applied wavetable oscillator's position envelope",
    signatures: [
      {
        label: "wtenv(amount)",
        parameters: [
          {
            label: "number amount",
            documentation: "between 0 and 1",
          },
        ],
      },
    ],
  },
  {
    name: "wtattack",
    detail: "wtattack/wavetable,envelope,superdough",
    documentation:
      "Attack time of the wavetable oscillator's position envelope",
    signatures: [
      {
        label: "wtattack(time)",
        parameters: [
          {
            label: "number time",
            documentation: "attack time in seconds",
          },
        ],
      },
    ],
  },
  {
    name: "wtdecay",
    detail: "wtdecay/wavetable,envelope,superdough",
    documentation: "Decay time of the wavetable oscillator's position envelope",
    signatures: [
      {
        label: "wtdecay(time)",
        parameters: [
          {
            label: "number time",
            documentation: "decay time in seconds",
          },
        ],
      },
    ],
  },
  {
    name: "wtsustain",
    detail: "wtsustain/wavetable,envelope,superdough",
    documentation:
      "Sustain time of the wavetable oscillator's position envelope",
    signatures: [
      {
        label: "wtsustain(gain)",
        parameters: [
          {
            label: "number gain",
            documentation: "sustain level (0 to 1)",
          },
        ],
      },
    ],
  },
  {
    name: "wtrelease",
    detail: "wtrelease/wavetable,envelope,superdough",
    documentation:
      "Release time of the wavetable oscillator's position envelope",
    signatures: [
      {
        label: "wtrelease(time)",
        parameters: [
          {
            label: "number time",
            documentation: "release time in seconds",
          },
        ],
      },
    ],
  },
  {
    name: "wtrate",
    detail: "wtrate/wavetable,lfo,superdough",
    documentation: "Rate of the LFO for the wavetable oscillator's position",
    signatures: [
      {
        label: "wtrate(rate)",
        parameters: [
          {
            label: "number rate",
            documentation: "rate in hertz",
          },
        ],
      },
    ],
  },
  {
    name: "wtsync",
    detail: "wtsync/wavetable,lfo,superdough",
    documentation:
      "cycle synced rate of the LFO for the wavetable oscillator's position",
    signatures: [
      {
        label: "wtsync(rate)",
        parameters: [
          {
            label: "number rate",
            documentation: "rate in cycles",
          },
        ],
      },
    ],
  },
  {
    name: "wtdepth",
    detail: "wtdepth/wavetable,lfo,superdough",
    documentation: "Depth of the LFO for the wavetable oscillator's position",
    signatures: [
      {
        label: "wtdepth(depth)",
        parameters: [
          {
            label: "number depth",
            documentation: "depth of modulation",
          },
        ],
      },
    ],
  },
  {
    name: "wtshape",
    detail: "wtshape/wavetable,lfo,superdough",
    documentation: "Shape of the LFO for the wavetable oscillator's position",
    signatures: [
      {
        label: "wtshape(shape)",
        parameters: [
          {
            label: "number shape",
            documentation: "Shape of the lfo (0, 1, 2, ..)",
          },
        ],
      },
    ],
  },
  {
    name: "wtdc",
    detail: "wtdc/wavetable,lfo,superdough",
    documentation:
      "DC offset of the LFO for the wavetable oscillator's position",
    signatures: [
      {
        label: "wtdc(dcoffset)",
        parameters: [
          {
            label: "number dcoffset",
            documentation: "dc offset. set to 0 for unipolar",
          },
        ],
      },
    ],
  },
  {
    name: "wtskew",
    detail: "wtskew/wavetable,lfo,superdough",
    documentation: "Skew of the LFO for the wavetable oscillator's position",
    signatures: [
      {
        label: "wtskew(skew)",
        parameters: [
          {
            label: "number skew",
            documentation: "How much to bend the LFO shape",
          },
        ],
      },
    ],
  },
  {
    name: "warp",
    detail: "warp/wavetable,superdough",
    documentation:
      "Amount of warp (alteration of the waveform) to apply to the wavetable oscillator",
    signatures: [
      {
        label: "warp(amount)",
        parameters: [
          {
            label: "number amount",
            documentation: "Warp of the wavetable from 0 to 1",
          },
        ],
      },
    ],
  },
  {
    name: "warpattack",
    detail: "warpattack/wavetable,envelope,superdough",
    documentation: "Attack time of the wavetable oscillator's warp envelope",
    signatures: [
      {
        label: "warpattack(time)",
        parameters: [
          {
            label: "number time",
            documentation: "attack time in seconds",
          },
        ],
      },
    ],
  },
  {
    name: "warpdecay",
    detail: "warpdecay/wavetable,envelope,superdough",
    documentation: "Decay time of the wavetable oscillator's warp envelope",
    signatures: [
      {
        label: "warpdecay(time)",
        parameters: [
          {
            label: "number time",
            documentation: "decay time in seconds",
          },
        ],
      },
    ],
  },
  {
    name: "warpsustain",
    detail: "warpsustain/wavetable,envelope,superdough",
    documentation: "Sustain time of the wavetable oscillator's warp envelope",
    signatures: [
      {
        label: "warpsustain(gain)",
        parameters: [
          {
            label: "number gain",
            documentation: "sustain level (0 to 1)",
          },
        ],
      },
    ],
  },
  {
    name: "warprelease",
    detail: "warprelease/wavetable,envelope,superdough",
    documentation: "Release time of the wavetable oscillator's warp envelope",
    signatures: [
      {
        label: "warprelease(time)",
        parameters: [
          {
            label: "number time",
            documentation: "release time in seconds",
          },
        ],
      },
    ],
  },
  {
    name: "warprate",
    detail: "warprate/wavetable,lfo,superdough",
    documentation: "Rate of the LFO for the wavetable oscillator's warp",
    signatures: [
      {
        label: "warprate(rate)",
        parameters: [
          {
            label: "number rate",
            documentation: "rate in hertz",
          },
        ],
      },
    ],
  },
  {
    name: "warpdepth",
    detail: "warpdepth/wavetable,lfo,superdough",
    documentation: "Depth of the LFO for the wavetable oscillator's warp",
    signatures: [
      {
        label: "warpdepth(depth)",
        parameters: [
          {
            label: "number depth",
            documentation: "depth of modulation",
          },
        ],
      },
    ],
  },
  {
    name: "warpshape",
    detail: "warpshape/wavetable,lfo,superdough",
    documentation: "Shape of the LFO for the wavetable oscillator's warp",
    signatures: [
      {
        label: "warpshape(shape)",
        parameters: [
          {
            label: "number shape",
            documentation: "Shape of the lfo (0, 1, 2, ..)",
          },
        ],
      },
    ],
  },
  {
    name: "warpdc",
    detail: "warpdc/wavetable,lfo,superdough",
    documentation: "DC offset of the LFO for the wavetable oscillator's warp",
    signatures: [
      {
        label: "warpdc(dcoffset)",
        parameters: [
          {
            label: "number dcoffset",
            documentation: "dc offset. set to 0 for unipolar",
          },
        ],
      },
    ],
  },
  {
    name: "warpskew",
    detail: "warpskew/wavetable,lfo,superdough",
    documentation: "Skew of the LFO for the wavetable oscillator's warp",
    signatures: [
      {
        label: "warpskew(skew)",
        parameters: [
          {
            label: "number skew",
            documentation: "How much to bend the LFO shape",
          },
        ],
      },
    ],
  },
  {
    name: "warpmode",
    detail: "warpmode/wavetable,superdough",
    documentation:
      "Type of warp (alteration of the waveform) to apply to the wavetable oscillator.\n\nThe current options are: none, asym, bendp, bendm, bendmp, sync, quant, fold,\npwm, orbit, spin, chaos, primes, binary, brownian, reciprocal, wormhole,\nlogistic, sigmoid, fractal, flip",
    signatures: [
      {
        label: "warpmode(mode)",
        parameters: [
          {
            label: "number mode",
            documentation: "Warp mode",
          },
        ],
      },
    ],
  },
  {
    name: "wtphaserand",
    detail: "wtphaserand/wavetable,superdough",
    documentation:
      "Amount of randomness of the initial phase of the wavetable oscillator.",
    signatures: [
      {
        label: "wtphaserand(amount)",
        parameters: [
          {
            label: "number amount",
            documentation:
              "Randomness of the initial phase. Between 0 (not random) and 1 (fully random)",
          },
        ],
      },
    ],
  },
  {
    name: "warpenv",
    detail: "warpenv/wavetable,envelope,superdough",
    documentation:
      "Amount of envelope applied wavetable oscillator's position envelope",
    signatures: [
      {
        label: "warpenv(amount)",
        parameters: [
          {
            label: "number amount",
            documentation: "between 0 and 1",
          },
        ],
      },
    ],
  },
  {
    name: "warpsync",
    detail: "warpsync/wavetable,lfo,superdough",
    documentation:
      "cycle synced rate of the LFO for the wavetable warp position",
    signatures: [
      {
        label: "warpsync(rate)",
        parameters: [
          {
            label: "number rate",
            documentation: "rate in cycles",
          },
        ],
      },
    ],
  },
  {
    name: "source",
    detail: "source/external_io,superdough",
    documentation: "Define a custom webaudio node to use as a sound source.",
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
      "Selects the given index:\n\n * for samples, it picks the sample by index, with wrap around\n * for scales, it picks the scale degree\n * for voicings, it picks the voice index",
    signatures: [
      {
        label: "n(value)",
        parameters: [
          {
            label: "number value",
            documentation: "sample index starting from 0",
          },
        ],
      },
    ],
  },
  {
    name: "i",
    detail: "i/tonal",
    documentation: "Selects the given degree. Currently used in xen and tune:",
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
      "Plays the given note name or midi number. A note name consists of\n\n * a letter (a-g or A-G)\n * optional accidentals (b or #)\n * optional (possibly negative) octave number (0-9). Defaults to 3\n\nExamples of valid note names: c, bb, Bb, f#, c3, A4, Eb2, c#5\n\nYou can also use midi numbers instead of note names, where 69 is mapped to A4\n440Hz in 12EDO.",
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
      "A pattern of numbers that speed up (or slow down) samples while they play.\nCurrently only supported by osc / superdirt.",
    signatures: [
      {
        label: "accelerate(amount)",
        parameters: [
          {
            label: "number amount",
            documentation: "acceleration.",
          },
        ],
      },
    ],
  },
  {
    name: "velocity",
    detail: "velocity/amplitude,superdough",
    documentation:
      "Sets the velocity from 0 to 1. Is multiplied together with gain.",
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
    documentation: "Controls the gain by an exponential amount.",
    signatures: [
      {
        label: "gain(amount)",
        parameters: [
          {
            label: "number amount",
            documentation: "gain.",
          },
        ],
      },
    ],
  },
  {
    name: "postgain",
    detail: "postgain/amplitude,superdough",
    documentation: "Gain applied after all effects have been processed.",
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
    documentation: "Like gain, but linear.",
    signatures: [
      {
        label: "amp(amount)",
        parameters: [
          {
            label: "number amount",
            documentation: "gain.",
          },
        ],
      },
    ],
  },
  {
    name: "fmh",
    detail: "fmh/fm,superdough",
    documentation:
      "Sets the Frequency Modulation Harmonicity Ratio. Controls the timbre of the\nsound. Whole numbers and simple ratios sound more natural, while decimal numbers\nand complex ratios sound metallic.\n\nA number may be added afterwards to control the harmonicity of any of the 8\nindividual FMs (e.g. fmh2)",
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
      "Sets the Frequency Modulation of the synth. Controls the modulation index, which\ndefines the brightness of the sound.\n\nA number may be added afterwards to control the modulation index of any of the 8\nindividual FMs (e.g. fm3). Also, FMs may be routed into each other with matrix\ncommands like fm13, which would send fm1 back into fm3",
    signatures: [
      {
        label: "fm(brightness)",
        parameters: [
          {
            label: "number brightness",
            documentation: "modulation index",
          },
        ],
      },
    ],
  },
  {
    name: "fmenv",
    detail: "fmenv/fm,envelope,superdough",
    documentation:
      "Ramp type of fm envelope. Exp might be a bit broken..\n\nA number may be added afterwards to control the envelope of any of the 8\nindividual FMs (e.g. fmenv4)",
    signatures: [
      {
        label: "fmenv(type)",
        parameters: [
          {
            label: "number type",
            documentation: "lin | exp",
          },
        ],
      },
    ],
  },
  {
    name: "fmattack",
    detail: "fmattack/fm,envelope,superdough",
    documentation:
      "Attack time for the FM envelope: time it takes to reach maximum modulation\n\nA number may be added afterwards to control the attack of the envelope of any of\nthe 8 individual FMs (e.g. fmatt5)",
    signatures: [
      {
        label: "fmattack(time)",
        parameters: [
          {
            label: "number time",
            documentation: "attack time",
          },
        ],
      },
    ],
  },
  {
    name: "fmwave",
    detail: "fmwave/fm,superdough",
    documentation:
      "Waveform of the fm modulator\n\nA number may be added afterwards to control the waveform any of the 8 individual\nFMs (e.g. fmwave6)",
    signatures: [
      {
        label: "fmwave(wave)",
        parameters: [
          {
            label: "number wave",
            documentation: "waveform",
          },
        ],
      },
    ],
  },
  {
    name: "fmdecay",
    detail: "fmdecay/fm,envelope,superdough",
    documentation:
      "Decay time for the FM envelope: seconds until the sustain level is reached after\nthe attack phase.\n\nA number may be added afterwards to control the decay of the envelope of any of\nthe 8 individual FMs (e.g. fmdec6)",
    signatures: [
      {
        label: "fmdecay(time)",
        parameters: [
          {
            label: "number time",
            documentation: "decay time",
          },
        ],
      },
    ],
  },
  {
    name: "fmsustain",
    detail: "fmsustain/fm,envelope,superdough",
    documentation:
      "Sustain level for the FM envelope: how much modulation is applied after the\ndecay phase\n\nA number may be added afterwards to control the sustain of the envelope of any\nof the 8 individual FMs (e.g. fmsus7)",
    signatures: [
      {
        label: "fmsustain(level)",
        parameters: [
          {
            label: "number level",
            documentation: "sustain level",
          },
        ],
      },
    ],
  },
  {
    name: "fmrelease",
    detail: "fmrelease/fm,envelope,superdough",
    documentation:
      "Release time for the FM envelope: how much modulation is applied after the note\nis released\n\nA number may be added afterwards to control the release of the envelope of any\nof the 8 individual FMs (e.g. fmrel8)",
    signatures: [
      {
        label: "fmrelease(time)",
        parameters: [
          {
            label: "number time",
            documentation: "release time",
          },
        ],
      },
    ],
  },
  {
    name: "bank",
    detail: "bank/samples,superdough",
    documentation:
      'Select the sound bank to use. To be used together with s. The bank name (+ "_")\nwill be prepended to the value of s.',
    signatures: [
      {
        label: "bank(bank)",
        parameters: [
          {
            label: "string bank",
            documentation: "the name of the bank",
          },
        ],
      },
    ],
  },
  {
    name: "chorus",
    detail: "chorus/pitch",
    documentation: "mix control for the chorus effect",
    signatures: [
      {
        label: "chorus(chorus)",
        parameters: [
          {
            label: "string chorus",
            documentation: "mix amount between 0 and 1",
          },
        ],
      },
    ],
  },
  {
    name: "attack",
    detail: "attack/amplitude,envelope,superdough",
    documentation:
      "Amplitude envelope attack time: Specifies how long it takes for the sound to\nreach its peak value, relative to the onset.",
    signatures: [
      {
        label: "attack(attack)",
        parameters: [
          {
            label: "number attack",
            documentation: "time in seconds.",
          },
        ],
      },
    ],
  },
  {
    name: "decay",
    detail: "decay/amplitude,envelope,superdough",
    documentation:
      "Amplitude envelope decay time: the time it takes after the attack time to reach\nthe sustain level. Note that the decay is only audible if the sustain value is\nlower than 1.",
    signatures: [
      {
        label: "decay(time)",
        parameters: [
          {
            label: "number time",
            documentation: "decay time in seconds",
          },
        ],
      },
    ],
  },
  {
    name: "sustain",
    detail: "sustain/amplitude,envelope,superdough",
    documentation:
      "Amplitude envelope sustain level: The level which is reached after attack /\ndecay, being sustained until the offset.",
    signatures: [
      {
        label: "sustain(gain)",
        parameters: [
          {
            label: "number gain",
            documentation: "sustain level between 0 and 1",
          },
        ],
      },
    ],
  },
  {
    name: "release",
    detail: "release/amplitude,envelope,superdough",
    documentation:
      "Amplitude envelope release time: The time it takes after the offset to go from\nsustain level to zero.",
    signatures: [
      {
        label: "release(time)",
        parameters: [
          {
            label: "number time",
            documentation: "release time in seconds",
          },
        ],
      },
    ],
  },
  {
    name: "bpf",
    detail: "bpf/filter,superdough",
    documentation:
      "Sets the center frequency of the band-pass filter. When using mininotation, you\ncan also optionally supply the 'bpq' parameter separated by ':'.",
    signatures: [
      {
        label: "bpf(frequency)",
        parameters: [
          {
            label: "number frequency",
            documentation: "center frequency",
          },
        ],
      },
    ],
  },
  {
    name: "bpq",
    detail: "bpq/filter,superdough",
    documentation: "Sets the band-pass q-factor (resonance).",
    signatures: [
      {
        label: "bpq(q)",
        parameters: [
          {
            label: "number q",
            documentation: "q factor",
          },
        ],
      },
    ],
  },
  {
    name: "begin",
    detail: "begin/samples",
    documentation:
      "A pattern of numbers from 0 to 1. Skips the beginning of each sample, e.g. 0.25\nto cut off the first quarter from each sample.",
    signatures: [
      {
        label: "begin(amount)",
        parameters: [
          {
            label: "number amount",
            documentation:
              "between 0 and 1, where 1 is the length of the sample",
          },
        ],
      },
    ],
  },
  {
    name: "end",
    detail: "Pattern.end/samples",
    documentation: "The same as .begin, but cuts off the end off each sample.",
    signatures: [
      {
        label: "end(length)",
        parameters: [
          {
            label: "number length",
            documentation:
              "1 = whole sample, .5 = half sample, .25 = quarter sample etc..",
          },
        ],
      },
    ],
  },
  {
    name: "loop",
    detail: "loop/samples",
    documentation:
      "Loops the sample. Note that the tempo of the loop is not synced with the cycle\ntempo. To change the loop region, use loopBegin / loopEnd.",
    signatures: [
      {
        label: "loop(on)",
        parameters: [
          {
            label: "number on",
            documentation: "If 1, the sample is looped",
          },
        ],
      },
    ],
  },
  {
    name: "loopBegin",
    detail: "loopBegin/samples",
    documentation:
      "Begin to loop at a specific point in the sample (inbetween begin and end). Note\nthat the loop point must be inbetween begin and end, and before loopEnd! Note:\nSamples starting with wt_ will automatically loop! (wt = wavetable)",
    signatures: [
      {
        label: "loopBegin(time)",
        parameters: [
          {
            label: "number time",
            documentation:
              "between 0 and 1, where 1 is the length of the sample",
          },
        ],
      },
    ],
  },
  {
    name: "loopEnd",
    detail: "loopEnd/samples",
    documentation:
      "End the looping section at a specific point in the sample (inbetween begin and\nend). Note that the loop point must be inbetween begin and end, and after\nloopBegin!",
    signatures: [
      {
        label: "loopEnd(time)",
        parameters: [
          {
            label: "number time",
            documentation:
              "between 0 and 1, where 1 is the length of the sample",
          },
        ],
      },
    ],
  },
  {
    name: "crush",
    detail: "crush/superdough",
    documentation: "Bit crusher effect.",
    signatures: [
      {
        label: "crush(depth)",
        parameters: [
          {
            label: "number depth",
            documentation:
              "between 1 (for drastic reduction in bit-depth) to 16 (for barely no reduction).",
          },
        ],
      },
    ],
  },
  {
    name: "coarse",
    detail: "coarse/superdough",
    documentation:
      "Fake-resampling for lowering the sample rate. Caution: This effect seems to only\nwork in chromium based browsers",
    signatures: [
      {
        label: "coarse(factor)",
        parameters: [
          {
            label: "number factor",
            documentation:
              "1 for original 2 for half, 3 for a third and so on.",
          },
        ],
      },
    ],
  },
  {
    name: "tremolo",
    detail: "tremolo/amplitude,lfo,superdough",
    documentation:
      "Modulate the amplitude of a sound with a continuous waveform",
    signatures: [
      {
        label: "tremolo(speed)",
        parameters: [
          {
            label: "number speed",
            documentation: "modulation speed in HZ",
          },
        ],
      },
    ],
  },
  {
    name: "tremolosync",
    detail: "tremolosync/amplitude,lfo,superdough",
    documentation:
      "Modulate the amplitude of a sound with a continuous waveform",
    signatures: [
      {
        label: "tremolosync(cycles)",
        parameters: [
          {
            label: "number cycles",
            documentation: "modulation speed in cycles",
          },
        ],
      },
    ],
  },
  {
    name: "tremolodepth",
    detail: "tremolodepth/amplitude,lfo,superdough",
    documentation: "Depth of amplitude modulation",
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
    documentation: "Alter the shape of the modulation waveform",
    signatures: [
      {
        label: "tremoloskew(amount)",
        parameters: [
          {
            label: "number amount",
            documentation: "between 0 & 1, the shape of the waveform",
          },
        ],
      },
    ],
  },
  {
    name: "tremolophase",
    detail: "tremolophase/amplitude,lfo,superdough",
    documentation: "Alter the phase of the modulation waveform",
    signatures: [
      {
        label: "tremolophase(offset)",
        parameters: [
          {
            label: "number offset",
            documentation: "the offset in cycles of the modulation",
          },
        ],
      },
    ],
  },
  {
    name: "tremoloshape",
    detail: "tremoloshape/amplitude,lfo,superdough",
    documentation: "Shape of amplitude modulation",
    signatures: [
      {
        label: "tremoloshape(shape)",
        parameters: [
          {
            label: "number shape",
            documentation: "tri | square | sine | saw | ramp",
          },
        ],
      },
    ],
  },
  {
    name: "drive",
    detail: "drive/filter,superdough",
    documentation: "Filter overdrive for supported filter types",
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
      'Modulate the amplitude of an orbit to create a "sidechain" like effect.\n\nCan be applied to multiple orbits with the \':\' mininotation, e.g.\nduckorbit("2:3")',
    signatures: [
      {
        label: "duckorbit(orbit)",
        parameters: [
          {
            label: "number orbit",
            documentation: "target orbit",
          },
        ],
      },
    ],
  },
  {
    name: "duckdepth",
    detail: "duckdepth/amplitude,orbit,superdough",
    documentation:
      'The amount of ducking applied to target orbit\n\nCan vary across orbits with the \':\' mininotation, e.g. duckdepth("0.3:0.1").\nNote: this requires first applying the effect to multiple orbits with e.g.\nduckorbit("2:3").',
    signatures: [
      {
        label: "duckdepth(depth)",
        parameters: [
          {
            label: "number depth",
            documentation: "depth of modulation from 0 to 1",
          },
        ],
      },
    ],
  },
  {
    name: "duckonset",
    detail: "duckonset/amplitude,envelope,orbit,superdough",
    documentation:
      'The time required for the ducked signal(s) to reach their lowest volume. Can be\nused to prevent clicking or for creative rhythmic effects.\n\nCan vary across orbits with the \':\' mininotation, e.g. duckonset("0:0.003").\nNote: this requires first applying the effect to multiple orbits with e.g.\nduckorbit("2:3").',
    signatures: [
      {
        label: "duckonset(time)",
        parameters: [
          {
            label: "number time",
            documentation: "The onset time in seconds",
          },
        ],
      },
    ],
  },
  {
    name: "duckattack",
    detail: "duckattack/amplitude,envelope,orbit,superdough",
    documentation:
      'The time required for the ducked signal(s) to return to their normal volume.\n\nCan vary across orbits with the \':\' mininotation, e.g. duckonset("0:0.003").\nNote: this requires first applying the effect to multiple orbits with e.g.\nduckorbit("2:3").',
    signatures: [
      {
        label: "duckattack(time)",
        parameters: [
          {
            label: "number time",
            documentation: "The attack time in seconds",
          },
        ],
      },
    ],
  },
  {
    name: "byteBeatExpression",
    detail: "byteBeatExpression/superdough",
    documentation: "Create byte beats with custom expressions",
    signatures: [
      {
        label: "byteBeatExpression(byteBeatExpression)",
        parameters: [
          {
            label: "number byteBeatExpression",
            documentation: "bitwise expression for creating bytebeat",
          },
        ],
      },
    ],
  },
  {
    name: "byteBeatStartTime",
    detail: "byteBeatStartTime/superdough",
    documentation: "Create byte beats with custom expressions",
    signatures: [
      {
        label: "byteBeatStartTime(byteBeatStartTime)",
        parameters: [
          {
            label: "number byteBeatStartTime",
            documentation: "in samples (t)",
          },
        ],
      },
    ],
  },
  {
    name: "channels",
    detail: "channels/external_io,superdough",
    documentation: "Allows you to set the output channels on the interface",
    signatures: [
      {
        label: "channels(channels)",
        parameters: [
          {
            label: "number channels",
            documentation: "pattern the output channels",
          },
        ],
      },
    ],
  },
  {
    name: "pw",
    detail: "pw/superdough",
    documentation: "Controls the pulsewidth of the pulse oscillator",
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
      "Controls the lfo rate for the pulsewidth of the pulse oscillator",
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
      "Controls the lfo sweep for the pulsewidth of the pulse oscillator",
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
      "Phaser audio effect that approximates popular guitar pedals.",
    signatures: [
      {
        label: "phaser(speed)",
        parameters: [
          {
            label: "number speed",
            documentation: "speed of modulation",
          },
        ],
      },
    ],
  },
  {
    name: "phasersweep",
    detail: "phasersweep/superdough,lfo",
    documentation:
      "The frequency sweep range of the lfo for the phaser effect. Defaults to 2000",
    signatures: [
      {
        label: "phasersweep(phasersweep)",
        parameters: [
          {
            label: "number phasersweep",
            documentation: "most useful values are between 0 and 4000",
          },
        ],
      },
    ],
  },
  {
    name: "phasercenter",
    detail: "phasercenter/superdough",
    documentation: "The center frequency of the phaser in HZ. Defaults to 1000",
    signatures: [
      {
        label: "phasercenter(centerfrequency)",
        parameters: [
          {
            label: "number centerfrequency",
            documentation: "in HZ",
          },
        ],
      },
    ],
  },
  {
    name: "phaserdepth",
    detail: "phaserdepth/superdough,superdirt",
    documentation:
      "The amount the signal is affected by the phaser effect. Defaults to 0.75",
    signatures: [
      {
        label: "phaserdepth(depth)",
        parameters: [
          {
            label: "number depth",
            documentation: "number between 0 and 1",
          },
        ],
      },
    ],
  },
  {
    name: "channel",
    detail: "channel/superdough",
    documentation: "Choose the channel the pattern is sent to",
    signatures: [
      {
        label: "channel(channel)",
        parameters: [
          {
            label: "number channel",
            documentation: "channel number",
          },
        ],
      },
    ],
  },
  {
    name: "cut",
    detail: "cut/superdough",
    documentation:
      "In the style of classic drum-machines, cut will stop a playing sample as soon as\nanother samples with in same cutgroup is to be played. An example would be an\nopen hi-hat followed by a closed one, essentially muting the open.",
    signatures: [
      {
        label: "cut(group)",
        parameters: [
          {
            label: "number group",
            documentation: "cut group number",
          },
        ],
      },
    ],
  },
  {
    name: "lpf",
    detail: "lpf/filter,superdough",
    documentation:
      "Applies the cutoff frequency of the low-pass filter.\n\nWhen using mininotation, you can also optionally add the 'lpq' parameter,\nseparated by ':'.",
    signatures: [
      {
        label: "lpf(frequency)",
        parameters: [
          {
            label: "number frequency",
            documentation: "audible between 0 and 20000",
          },
        ],
      },
    ],
  },
  {
    name: "lpenv",
    detail: "lpenv/filter,envelope,superdough",
    documentation: "Sets the lowpass filter envelope modulation depth.",
    signatures: [
      {
        label: "lpenv(modulation)",
        parameters: [
          {
            label: "number modulation",
            documentation:
              "depth of the lowpass filter envelope between 0 and n",
          },
        ],
      },
    ],
  },
  {
    name: "hpenv",
    detail: "hpenv/filter,envelope,superdough",
    documentation: "Sets the highpass filter envelope modulation depth.",
    signatures: [
      {
        label: "hpenv(modulation)",
        parameters: [
          {
            label: "number modulation",
            documentation:
              "depth of the highpass filter envelope between 0 and n",
          },
        ],
      },
    ],
  },
  {
    name: "bpenv",
    detail: "bpenv/filter,envelope,superdough",
    documentation: "Sets the bandpass filter envelope modulation depth.",
    signatures: [
      {
        label: "bpenv(modulation)",
        parameters: [
          {
            label: "number modulation",
            documentation:
              "depth of the bandpass filter envelope between 0 and n",
          },
        ],
      },
    ],
  },
  {
    name: "lpattack",
    detail: "lpattack/filter,envelope,superdough",
    documentation: "Sets the attack duration for the lowpass filter envelope.",
    signatures: [
      {
        label: "lpattack(attack)",
        parameters: [
          {
            label: "number attack",
            documentation: "time of the filter envelope",
          },
        ],
      },
    ],
  },
  {
    name: "hpattack",
    detail: "hpattack/filter,envelope,superdough",
    documentation: "Sets the attack duration for the highpass filter envelope.",
    signatures: [
      {
        label: "hpattack(attack)",
        parameters: [
          {
            label: "number attack",
            documentation: "time of the highpass filter envelope",
          },
        ],
      },
    ],
  },
  {
    name: "bpattack",
    detail: "bpattack/filter,envelope,superdough",
    documentation: "Sets the attack duration for the bandpass filter envelope.",
    signatures: [
      {
        label: "bpattack(attack)",
        parameters: [
          {
            label: "number attack",
            documentation: "time of the bandpass filter envelope",
          },
        ],
      },
    ],
  },
  {
    name: "lpdecay",
    detail: "lpdecay/filter,envelope,superdough",
    documentation: "Sets the decay duration for the lowpass filter envelope.",
    signatures: [
      {
        label: "lpdecay(decay)",
        parameters: [
          {
            label: "number decay",
            documentation: "time of the filter envelope",
          },
        ],
      },
    ],
  },
  {
    name: "hpdecay",
    detail: "hpdecay/filter,envelope,superdough",
    documentation: "Sets the decay duration for the highpass filter envelope.",
    signatures: [
      {
        label: "hpdecay(decay)",
        parameters: [
          {
            label: "number decay",
            documentation: "time of the highpass filter envelope",
          },
        ],
      },
    ],
  },
  {
    name: "bpdecay",
    detail: "bpdecay/filter,envelope,superdough",
    documentation: "Sets the decay duration for the bandpass filter envelope.",
    signatures: [
      {
        label: "bpdecay(decay)",
        parameters: [
          {
            label: "number decay",
            documentation: "time of the bandpass filter envelope",
          },
        ],
      },
    ],
  },
  {
    name: "lpsustain",
    detail: "lpsustain/filter,envelope,superdough",
    documentation:
      "Sets the sustain amplitude for the lowpass filter envelope.",
    signatures: [
      {
        label: "lpsustain(sustain)",
        parameters: [
          {
            label: "number sustain",
            documentation: "amplitude of the lowpass filter envelope",
          },
        ],
      },
    ],
  },
  {
    name: "hpsustain",
    detail: "hpsustain/filter,envelope,superdough",
    documentation:
      "Sets the sustain amplitude for the highpass filter envelope.",
    signatures: [
      {
        label: "hpsustain(sustain)",
        parameters: [
          {
            label: "number sustain",
            documentation: "amplitude of the highpass filter envelope",
          },
        ],
      },
    ],
  },
  {
    name: "bpsustain",
    detail: "bpsustain/filter,envelope,superdough",
    documentation:
      "Sets the sustain amplitude for the bandpass filter envelope.",
    signatures: [
      {
        label: "bpsustain(sustain)",
        parameters: [
          {
            label: "number sustain",
            documentation: "amplitude of the bandpass filter envelope",
          },
        ],
      },
    ],
  },
  {
    name: "lprelease",
    detail: "lprelease/filter,envelope,superdough",
    documentation: "Sets the release time for the lowpass filter envelope.",
    signatures: [
      {
        label: "lprelease(release)",
        parameters: [
          {
            label: "number release",
            documentation: "time of the filter envelope",
          },
        ],
      },
    ],
  },
  {
    name: "hprelease",
    detail: "hprelease/filter,envelope,superdough",
    documentation: "Sets the release time for the highpass filter envelope.",
    signatures: [
      {
        label: "hprelease(release)",
        parameters: [
          {
            label: "number release",
            documentation: "time of the highpass filter envelope",
          },
        ],
      },
    ],
  },
  {
    name: "bprelease",
    detail: "bprelease/filter,envelope,superdough",
    documentation: "Sets the release time for the bandpass filter envelope.",
    signatures: [
      {
        label: "bprelease(release)",
        parameters: [
          {
            label: "number release",
            documentation: "time of the bandpass filter envelope",
          },
        ],
      },
    ],
  },
  {
    name: "ftype",
    detail: "ftype/filter,superdough",
    documentation:
      "Sets the filter type. The ladder filter is more aggressive. More types might be\nadded in the future.",
    signatures: [
      {
        label: "ftype(type)",
        parameters: [
          {
            label: "number type",
            documentation: "12db (0), ladder (1), or 24db (2)",
          },
        ],
      },
    ],
  },
  {
    name: "fanchor",
    detail: "fanchor/filter,envelope,superdough",
    documentation:
      "controls the center of the filter envelope. 0 is unipolar positive, .5 is\nbipolar, 1 is unipolar negative",
    signatures: [
      {
        label: "fanchor(center)",
        parameters: [
          {
            label: "number center",
            documentation: "0 to 1",
          },
        ],
      },
    ],
  },
  {
    name: "hpf",
    detail: "hpf/filter,superdough",
    documentation:
      "Applies the cutoff frequency of the high-pass filter.\n\nWhen using mininotation, you can also optionally add the 'hpq' parameter,\nseparated by ':'.",
    signatures: [
      {
        label: "hpf(frequency)",
        parameters: [
          {
            label: "number frequency",
            documentation: "audible between 0 and 20000",
          },
        ],
      },
    ],
  },
  {
    name: "lprate",
    detail: "lprate/filter,lfo,superdough",
    documentation: "Rate of the LFO for the lowpass filter",
    signatures: [
      {
        label: "lprate(rate)",
        parameters: [
          {
            label: "number rate",
            documentation: "rate in hertz",
          },
        ],
      },
    ],
  },
  {
    name: "lpsync",
    detail: "lpsync/filter,lfo,superdough",
    documentation: "Cycle-synced rate of the LFO for the lowpass filter",
    signatures: [
      {
        label: "lpsync(rate)",
        parameters: [
          {
            label: "number rate",
            documentation: "rate in cycles",
          },
        ],
      },
    ],
  },
  {
    name: "lpdepth",
    detail: "lpdepth/filter,lfo,superdough",
    documentation: "Depth of the LFO for the lowpass filter",
    signatures: [
      {
        label: "lpdepth(depth)",
        parameters: [
          {
            label: "number depth",
            documentation: "depth of modulation",
          },
        ],
      },
    ],
  },
  {
    name: "lpdepthfrequency",
    detail: "lpdepthfrequency/filter,lfo,superdough",
    documentation: "Depth of the LFO for the lowpass filter, in HZ",
    signatures: [
      {
        label: "lpdepthfrequency(depth)",
        parameters: [
          {
            label: "number depth",
            documentation: "depth of modulation",
          },
        ],
      },
    ],
  },
  {
    name: "lpshape",
    detail: "lpshape/filter,lfo,superdough",
    documentation: "Shape of the LFO for the lowpass filter",
    signatures: [
      {
        label: "lpshape(shape)",
        parameters: [
          {
            label: "number shape",
            documentation: "Shape of the lfo (0, 1, 2, ..)",
          },
        ],
      },
    ],
  },
  {
    name: "lpdc",
    detail: "lpdc/filter,lfo,superdough",
    documentation: "DC offset of the LFO for the lowpass filter",
    signatures: [
      {
        label: "lpdc(dcoffset)",
        parameters: [
          {
            label: "number dcoffset",
            documentation: "dc offset. set to 0 for unipolar",
          },
        ],
      },
    ],
  },
  {
    name: "lpskew",
    detail: "lpskew/filter,lfo,superdough",
    documentation: "Skew of the LFO for the lowpass filter",
    signatures: [
      {
        label: "lpskew(skew)",
        parameters: [
          {
            label: "number skew",
            documentation: "How much to bend the LFO shape",
          },
        ],
      },
    ],
  },
  {
    name: "bprate",
    detail: "bprate/filter,lfo,superdough",
    documentation: "Rate of the LFO for the bandpass filter",
    signatures: [
      {
        label: "bprate(rate)",
        parameters: [
          {
            label: "number rate",
            documentation: "rate in hertz",
          },
        ],
      },
    ],
  },
  {
    name: "bpsync",
    detail: "bpsync/filter,lfo,superdough",
    documentation: "Cycle-synced rate of the LFO for the bandpass filter",
    signatures: [
      {
        label: "bpsync(rate)",
        parameters: [
          {
            label: "number rate",
            documentation: "rate in cycles",
          },
        ],
      },
    ],
  },
  {
    name: "bpdepth",
    detail: "bpdepth/filter,lfo,superdough",
    documentation: "Depth of the LFO for the bandpass filter",
    signatures: [
      {
        label: "bpdepth(depth)",
        parameters: [
          {
            label: "number depth",
            documentation: "depth of modulation",
          },
        ],
      },
    ],
  },
  {
    name: "bpdepthfrequency",
    detail: "bpdepthfrequency/filter,lfo,superdough",
    documentation: "Depth of the LFO for the bandpass filter, in HZ",
    signatures: [
      {
        label: "bpdepthfrequency(depth)",
        parameters: [
          {
            label: "number depth",
            documentation: "depth of modulation",
          },
        ],
      },
    ],
  },
  {
    name: "bpshape",
    detail: "bpshape/filter,lfo,superdough",
    documentation: "Shape of the LFO for the bandpass filter",
    signatures: [
      {
        label: "bpshape(shape)",
        parameters: [
          {
            label: "number shape",
            documentation: "Shape of the lfo (0, 1, 2, ..)",
          },
        ],
      },
    ],
  },
  {
    name: "bpdc",
    detail: "bpdc/filter,lfo,superdough",
    documentation: "DC offset of the LFO for the bandpass filter",
    signatures: [
      {
        label: "bpdc(dcoffset)",
        parameters: [
          {
            label: "number dcoffset",
            documentation: "dc offset. set to 0 for unipolar",
          },
        ],
      },
    ],
  },
  {
    name: "bpskew",
    detail: "bpskew/filter,lfo,superdough",
    documentation: "Skew of the LFO for the bandpass filter",
    signatures: [
      {
        label: "bpskew(skew)",
        parameters: [
          {
            label: "number skew",
            documentation: "How much to bend the LFO shape",
          },
        ],
      },
    ],
  },
  {
    name: "hprate",
    detail: "hprate/filter,lfo,superdough",
    documentation: "Rate of the LFO for the highpass filter",
    signatures: [
      {
        label: "hprate(rate)",
        parameters: [
          {
            label: "number rate",
            documentation: "rate in hertz",
          },
        ],
      },
    ],
  },
  {
    name: "hpsync",
    detail: "hpsync/filter,lfo,superdough",
    documentation: "Cycle-synced rate of the LFO for the highpass filter",
    signatures: [
      {
        label: "hpsync(rate)",
        parameters: [
          {
            label: "number rate",
            documentation: "rate in cycles",
          },
        ],
      },
    ],
  },
  {
    name: "hpdepth",
    detail: "hpdepth/filter,lfo,superdough",
    documentation: "Depth of the LFO for the highpass filter",
    signatures: [
      {
        label: "hpdepth(depth)",
        parameters: [
          {
            label: "number depth",
            documentation: "depth of modulation",
          },
        ],
      },
    ],
  },
  {
    name: "hpdepthfrequency",
    detail: "hpdepthfrequency/filter,lfo,superdough",
    documentation: "Depth of the LFO for the hipass filter, in hz",
    signatures: [
      {
        label: "hpdepthfrequency(depth)",
        parameters: [
          {
            label: "number depth",
            documentation: "depth of modulation",
          },
        ],
      },
    ],
  },
  {
    name: "hpshape",
    detail: "hpshape/filter,lfo,superdough",
    documentation: "Shape of the LFO for the highpass filter",
    signatures: [
      {
        label: "hpshape(shape)",
        parameters: [
          {
            label: "number shape",
            documentation: "Shape of the lfo (0, 1, 2, ..)",
          },
        ],
      },
    ],
  },
  {
    name: "hpdc",
    detail: "hpdc/filter,lfo,superdough",
    documentation: "DC offset of the LFO for the highpass filter",
    signatures: [
      {
        label: "hpdc(dcoffset)",
        parameters: [
          {
            label: "number dcoffset",
            documentation: "dc offset. set to 0 for unipolar",
          },
        ],
      },
    ],
  },
  {
    name: "hpskew",
    detail: "hpskew/filter,lfo,superdough",
    documentation: "Skew of the LFO for the highpass filter",
    signatures: [
      {
        label: "hpskew(skew)",
        parameters: [
          {
            label: "number skew",
            documentation: "How much to bend the LFO shape",
          },
        ],
      },
    ],
  },
  {
    name: "vib",
    detail: "vib/pitch,lfo,superdough",
    documentation: "Applies a vibrato to the frequency of the oscillator.",
    signatures: [
      {
        label: "vib(frequency)",
        parameters: [
          {
            label: "number frequency",
            documentation: "of the vibrato in hertz",
          },
        ],
      },
    ],
  },
  {
    name: "noise",
    detail: "noise/generators,superdough",
    documentation: "Adds pink noise to the mix",
    signatures: [
      {
        label: "noise(wet)",
        parameters: [
          {
            label: "number wet",
            documentation: "wet amount",
          },
        ],
      },
    ],
  },
  {
    name: "vibmod",
    detail: "vibmod/pitch,lfo,superdough",
    documentation:
      "Sets the vibrato depth in semitones. Only has an effect if vibrato | vib | v is\nis also set",
    signatures: [
      {
        label: "vibmod(depth)",
        parameters: [
          {
            label: "number depth",
            documentation: "of vibrato (in semitones)",
          },
        ],
      },
    ],
  },
  {
    name: "hpq",
    detail: "hpq/filter,superdough",
    documentation: "Controls the high-pass q-value.",
    signatures: [
      {
        label: "hpq(q)",
        parameters: [
          {
            label: "number q",
            documentation: "resonance factor between 0 and 50",
          },
        ],
      },
    ],
  },
  {
    name: "lpq",
    detail: "lpq/filter,superdough",
    documentation: "Controls the low-pass q-value.",
    signatures: [
      {
        label: "lpq(q)",
        parameters: [
          {
            label: "number q",
            documentation: "resonance factor between 0 and 50",
          },
        ],
      },
    ],
  },
  {
    name: "djf",
    detail: "djf/filter,superdough",
    documentation:
      "DJ filter, below 0.5 is low pass filter, above is high pass filter.",
    signatures: [
      {
        label: "djf(cutoff)",
        parameters: [
          {
            label: "number cutoff",
            documentation:
              "below 0.5 is low pass filter, above is high pass filter",
          },
        ],
      },
    ],
  },
  {
    name: "delay",
    detail: "delay/orbit,superdough",
    documentation:
      "Sets the level of the delay signal.\n\nWhen using mininotation, you can also optionally add the 'delaytime' and\n'delayfeedback' parameter, separated by ':'.",
    signatures: [
      {
        label: "delay(level)",
        parameters: [
          {
            label: "number level",
            documentation: "between 0 and 1",
          },
        ],
      },
    ],
  },
  {
    name: "delayfeedback",
    detail: "delayfeedback/orbit,superdough",
    documentation:
      "Sets the level of the signal that is fed back into the delay. Caution: Values >=\n1 will result in a signal that gets louder and louder! Don't do it",
    signatures: [
      {
        label: "delayfeedback(feedback)",
        parameters: [
          {
            label: "number feedback",
            documentation: "between 0 and 1",
          },
        ],
      },
    ],
  },
  {
    name: "delaytime",
    detail: "delaytime/orbit,superdough",
    documentation: "Sets the time of the delay effect in seconds.",
    signatures: [
      {
        label: "delaytime(delay)",
        parameters: [
          {
            label: "number delay",
            documentation: "in seconds",
          },
        ],
      },
    ],
  },
  {
    name: "delaysync",
    detail: "delaysync/orbit,superdough",
    documentation: "Sets the time of the delay effect in cycles.",
    signatures: [
      {
        label: "delaysync(cycles)",
        parameters: [
          {
            label: "number cycles",
            documentation: "delay length in cycles",
          },
        ],
      },
    ],
  },
  {
    name: "lock",
    detail: "lock/superdirt,superdirtonly",
    documentation: "Specifies whether delaytime is calculated relative to cps.",
    signatures: [
      {
        label: "lock(enable)",
        parameters: [
          {
            label: "number enable",
            documentation:
              "When set to 1, delaytime is a direct multiple of a cycle.",
          },
        ],
      },
    ],
  },
  {
    name: "detune",
    detail: "detune/pitch,superdough",
    documentation: "Set detune for stacked voices of supported oscillators.",
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
    documentation: "Set number of stacked voices for supported oscillators.",
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
    documentation: "Set the stereo pan spread for supported oscillators",
    signatures: [
      {
        label: "spread(spread)",
        parameters: [
          {
            label: "number spread",
            documentation: "between 0 and 1",
          },
        ],
      },
    ],
  },
  {
    name: "dry",
    detail: "dry/superdirt,superdough",
    documentation:
      "Set dryness of reverb. See room and size for more information about reverb.",
    signatures: [
      {
        label: "dry(dry)",
        parameters: [
          {
            label: "number dry",
            documentation: "0 = wet, 1 = dry",
          },
        ],
      },
    ],
  },
  {
    name: "fadeTime",
    detail: "fadeTime/superdirt",
    documentation:
      "Used when using begin/end or chop/striate and friends, to change the fade out\ntime of the 'grain' envelope.",
    signatures: [
      {
        label: "fadeTime(time)",
        parameters: [
          {
            label: "number time",
            documentation: "between 0 and 1",
          },
        ],
      },
    ],
  },
  {
    name: "freq",
    detail: "freq/pitch,superdough",
    documentation: "Set frequency of sound.",
    signatures: [
      {
        label: "freq(frequency)",
        parameters: [
          {
            label: "number frequency",
            documentation:
              "in Hz. the audible range is between 20 and 20000 Hz",
          },
        ],
      },
    ],
  },
  {
    name: "pattack",
    detail: "pattack/pitch,envelope,superdough",
    documentation: "Attack time of pitch envelope.",
    signatures: [
      {
        label: "pattack(time)",
        parameters: [
          {
            label: "number time",
            documentation: "time in seconds",
          },
        ],
      },
    ],
  },
  {
    name: "pdecay",
    detail: "pdecay/pitch,envelope,superdough",
    documentation: "Decay time of pitch envelope.",
    signatures: [
      {
        label: "pdecay(time)",
        parameters: [
          {
            label: "number time",
            documentation: "time in seconds",
          },
        ],
      },
    ],
  },
  {
    name: "prelease",
    detail: "prelease/pitch,envelope,superdough",
    documentation: "Release time of pitch envelope",
    signatures: [
      {
        label: "prelease(time)",
        parameters: [
          {
            label: "number time",
            documentation: "time in seconds",
          },
        ],
      },
    ],
  },
  {
    name: "penv",
    detail: "penv/pitch,envelope,superdough",
    documentation:
      "Amount of pitch envelope. Negative values will flip the envelope. If you don't\nset other pitch envelope controls, pattack:.2 will be the default.",
    signatures: [
      {
        label: "penv(semitones)",
        parameters: [
          {
            label: "number semitones",
            documentation: "change in semitones",
          },
        ],
      },
    ],
  },
  {
    name: "pcurve",
    detail: "pcurve/pitch,envelope,superdough",
    documentation:
      "Curve of envelope. Defaults to linear. exponential is good for kicks",
    signatures: [
      {
        label: "pcurve(type)",
        parameters: [
          {
            label: "number type",
            documentation: "0 = linear, 1 = exponential",
          },
        ],
      },
    ],
  },
  {
    name: "panchor",
    detail: "panchor/pitch,envelope,superdough",
    documentation:
      "Sets the range anchor of the envelope:\n\n * anchor 0: range = [note, note + penv]\n * anchor 1: range = [note - penv, note] If you don't set an anchor, the value\n   will default to the psustain value.",
    signatures: [
      {
        label: "panchor(anchor)",
        parameters: [
          {
            label: "number anchor",
            documentation: "anchor offset",
          },
        ],
      },
    ],
  },
  {
    name: "leslie",
    detail: "leslie/superdirt,superdirtonly",
    documentation:
      "Emulation of a Leslie speaker: speakers rotating in a wooden amplified cabinet.",
    signatures: [
      {
        label: "leslie(wet)",
        parameters: [
          {
            label: "number wet",
            documentation: "between 0 and 1",
          },
        ],
      },
    ],
  },
  {
    name: "lrate",
    detail: "lrate/superdirt,superdirtonly",
    documentation: "Rate of modulation / rotation for leslie effect",
    signatures: [
      {
        label: "lrate(rate)",
        parameters: [
          {
            label: "number rate",
            documentation: "6.7 for fast, 0.7 for slow",
          },
        ],
      },
    ],
  },
  {
    name: "lsize",
    detail: "lsize/superdirt,superdirtonly",
    documentation:
      "Physical size of the cabinet in meters. Be careful, it might be slightly larger\nthan your computer. Affects the Doppler amount (pitch warble)",
    signatures: [
      {
        label: "lsize(meters)",
        parameters: [
          {
            label: "number meters",
            documentation: "somewhere between 0 and 1",
          },
        ],
      },
    ],
  },
  {
    name: "label",
    detail: "label/visualization",
    documentation: "Sets the displayed text for an event on the pianoroll",
    signatures: [
      {
        label: "label(label)",
        parameters: [
          {
            label: "string label",
            documentation: "text to display",
          },
        ],
      },
    ],
  },
  {
    name: "octave",
    detail: "octave/superdirt",
    documentation: "Sets the default octave of a synth.",
    signatures: [
      {
        label: "octave(octave)",
        parameters: [
          {
            label: "number octave",
            documentation: "octave number",
          },
        ],
      },
    ],
  },
  {
    name: "orbit",
    detail: "orbit/superdough",
    documentation:
      "An orbit is a global parameter context for patterns. Patterns with the same\norbit will share the same global effects.",
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
      'A bus is a send which can be used for mixing patterns. It combines with..\ns("bus") to play that bus through another pattern (for, say, applying non-linear\neffects like distortion to multiple signals)\n\notherPat.bmod(..) (to modulate another pattern with the bus)',
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
      "Postgain multiplier prior to sending the signal to the audio bus.",
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
    documentation: "Sets position in stereo.",
    signatures: [
      {
        label: "pan(pan)",
        parameters: [
          {
            label: "number pan",
            documentation:
              "between 0 and 1, from left to right (assuming stereo), once round a circle\n(assuming multichannel)",
          },
        ],
      },
    ],
  },
  {
    name: "panspan",
    detail: "panspan/superdirt",
    documentation: "Controls how much multichannel output is fanned out",
    signatures: [
      {
        label: "panspan(span)",
        parameters: [
          {
            label: "number span",
            documentation:
              "between -inf and inf, negative is backwards ordering",
          },
        ],
      },
    ],
  },
  {
    name: "pansplay",
    detail: "pansplay/superdirt",
    documentation: "Controls how much multichannel output is spread",
    signatures: [
      {
        label: "pansplay(spread)",
        parameters: [
          {
            label: "number spread",
            documentation: "between 0 and 1",
          },
        ],
      },
    ],
  },
  {
    name: "chord",
    detail: "chord/tonal",
    documentation: "The chord to voice",
    signatures: [
      {
        label: "chord(symbols)",
        parameters: [
          {
            label: "string symbols",
            documentation:
              "chord symbols to voice e.g., C, Eb, Fm7, G7. The symbols can be defined via\naddVoicings",
          },
        ],
      },
    ],
  },
  {
    name: "dictionary",
    detail: "dictionary/tonal",
    documentation:
      "Which dictionary to use for the voicings. This falls back to the default\ndictionary if not provided",
    signatures: [
      {
        label: "dictionary(dictionaryName)",
        parameters: [
          {
            label: "string dictionaryName",
            documentation:
              "which dictionary (having been defined with addVoicings) to use",
          },
        ],
      },
    ],
  },
  {
    name: "anchor",
    detail: "anchor/tonal",
    documentation: "The top note to align the voicing to. Defaults to c5",
    signatures: [
      {
        label: "anchor(anchorNote)",
        parameters: [
          {
            label: "string anchorNote",
            documentation: "the note to align the voicing or scale to",
          },
        ],
      },
    ],
  },
  {
    name: "offset",
    detail: "offset/tonal",
    documentation: "Sets how the voicing is offset from the anchored position",
    signatures: [
      {
        label: "offset(shift)",
        parameters: [
          {
            label: "number shift",
            documentation: "the amount to shift the voicing up or down",
          },
        ],
      },
    ],
  },
  {
    name: "octaves",
    detail: "octaves/tonal",
    documentation:
      "How many octaves are voicing steps spread apart, defaults to 1",
    signatures: [
      {
        label: "octaves(count)",
        parameters: [
          {
            label: "number count",
            documentation: "the number of octaves",
          },
        ],
      },
    ],
  },
  {
    name: "mode",
    detail: "mode/tonal",
    documentation:
      "How the voicing is aligned to the anchor\n\n * below: top note <= anchor\n\n * duck: top note <= anchor, anchor excluded\n\n * above: bottom note >= anchor\n\n * root: bottom note is the lowest root of the chord >= anchor\n\n * oldabove : old (buggy) behavior of above, kept for legacy reason\n\n * oldroot : old (buggy) behavior of root, kept for legacy reason",
    signatures: [
      {
        label: "mode(modeName)",
        parameters: [
          {
            label: "string modeName",
            documentation:
              "one of {below | above | duck | root | oldabove | oldroot}",
          },
        ],
      },
    ],
  },
  {
    name: "room",
    detail: "room/orbit,superdough",
    documentation:
      "Sets the level of reverb.\n\nWhen using mininotation, you can also optionally add the 'size' parameter,\nseparated by ':'.",
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
      "Reverb lowpass starting frequency (in hertz). When this property is changed, the\nreverb will be recaculated, so only change this sparsely..",
    signatures: [
      {
        label: "roomlp(frequency)",
        parameters: [
          {
            label: "number frequency",
            documentation: "between 0 and 20000hz",
          },
        ],
      },
    ],
  },
  {
    name: "roomdim",
    detail: "roomdim/orbit,superdough",
    documentation:
      "Reverb lowpass frequency at -60dB (in hertz). When this property is changed, the\nreverb will be recaculated, so only change this sparsely..",
    signatures: [
      {
        label: "roomdim(frequency)",
        parameters: [
          {
            label: "number frequency",
            documentation: "between 0 and 20000hz",
          },
        ],
      },
    ],
  },
  {
    name: "roomfade",
    detail: "roomfade/orbit,superdough",
    documentation:
      "Reverb fade time (in seconds). When this property is changed, the reverb will be\nrecaculated, so only change this sparsely..",
    signatures: [
      {
        label: "roomfade(seconds)",
        parameters: [
          {
            label: "number seconds",
            documentation: "for the reverb to fade",
          },
        ],
      },
    ],
  },
  {
    name: "iresponse",
    detail: "iresponse/orbit,superdough",
    documentation:
      "Sets the sample to use as an impulse response for the reverb.",
    signatures: [
      {
        label: "iresponse(sample)",
        parameters: [
          {
            label: "string sample",
            documentation: "to use as an impulse response",
          },
        ],
      },
    ],
  },
  {
    name: "irspeed",
    detail: "irspeed/orbit,superdough",
    documentation: "Sets speed of the sample for the impulse response.",
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
    documentation: "Sets the beginning of the IR response sample",
    signatures: [
      {
        label: "irbegin(begin)",
        parameters: [
          {
            label: "string begin",
            documentation: "between 0 and 1",
          },
        ],
      },
    ],
  },
  {
    name: "roomsize",
    detail: "roomsize/orbit,superdough",
    documentation:
      "Sets the room size of the reverb, see room. When this property is changed, the\nreverb will be recaculated, so only change this sparsely..",
    signatures: [
      {
        label: "roomsize(size)",
        parameters: [
          {
            label: "number size",
            documentation: "between 0 and 10",
          },
        ],
      },
    ],
  },
  {
    name: "shape",
    detail: "shape/distortion,superdough",
    documentation:
      '(Deprecated) Wave shaping distortion. WARNING: can suddenly get unpredictably\nloud. Please use distort instead, which has a more predictable response curve\nsecond option in optional array syntax (ex: ".9:.5") applies a postgain to the\noutput',
    signatures: [
      {
        label: "shape(distortion)",
        parameters: [
          {
            label: "number distortion",
            documentation: "between 0 and 1",
          },
        ],
      },
    ],
  },
  {
    name: "distort",
    detail: "distort/distortion,superdough",
    documentation:
      'Wave shaping distortion. CAUTION: it can get loud. Second option in optional\narray syntax (ex: ".9:.5") applies a postgain to the output. Third option sets\nthe waveshaping type. Most useful values are usually between 0 and 10 (depending\non source gain). If you are feeling adventurous, you can turn it up to 11 and\nbeyond ;)',
    signatures: [
      {
        label: "distort(distortion, volume, type)",
        parameters: [
          {
            label: "number distortion",
            documentation: "amount of distortion to apply",
          },
          {
            label: "number volume",
            documentation: "linear postgain of the distortion",
          },
          {
            label: "number type",
            documentation: "type of distortion to apply",
          },
        ],
      },
    ],
  },
  {
    name: "distortvol",
    detail: "distortvol/superdough",
    documentation: "Postgain for waveshaping distortion.",
    signatures: [
      {
        label: "distortvol(volume)",
        parameters: [
          {
            label: "number volume",
            documentation: "linear postgain of the distortion",
          },
        ],
      },
    ],
  },
  {
    name: "distorttype",
    detail: "distorttype/distortion,superdough",
    documentation: "Type of waveshaping distortion to apply.",
    signatures: [
      {
        label: "distorttype(type)",
        parameters: [
          {
            label: "number type",
            documentation: "type of distortion to apply",
          },
        ],
      },
    ],
  },
  {
    name: "compressor",
    detail: "compressor/superdough",
    documentation:
      'Dynamics Compressor. The params are\ncompressor("threshold:ratio:knee:attack:release") More info here\n[https://developer.mozilla.org/en-US/docs/Web/API/DynamicsCompressorNode?retiredLocale=de#instance_properties]',
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
      "Changes the speed of sample playback, i.e. a cheap way of changing pitch.",
    signatures: [
      {
        label: "speed(speed)",
        parameters: [
          {
            label: "number speed",
            documentation:
              "inf to inf, negative numbers play the sample backwards.",
          },
        ],
      },
    ],
  },
  {
    name: "stretch",
    detail: "stretch/pitch,samples",
    documentation:
      "Changes the pitch of the sample without changing its speed. The frequencies are\nmultiplied by (factor + 1) for positive numbers and by max(factor / 4 + 1, 0)\nfor negative numbers. So tuning up by octaves can be done with 1, 3, 7, ... and\ntuning down by octaves with -2, -3, -3.5...",
    signatures: [
      {
        label: "stretch(factor)",
        parameters: [
          {
            label: "number factor",
            documentation:
              "between -4 and inf. Positive increases pitch, 0 does nothing, negative decreases\nthe pitch.",
          },
        ],
      },
    ],
  },
  {
    name: "unit",
    detail: "unit/superdirt,superdirtonly",
    documentation:
      'Used in conjunction with speed, accepts values of "r" (rate, default behavior),\n"c" (cycles), or "s" (seconds). Using unit "c" means speed will be interpreted\nin units of cycles, e.g. speed "1" means samples will be stretched to fill a\ncycle. Using unit "s" means the playback speed will be adjusted so that the\nduration is the number of seconds specified by speed.',
    signatures: [
      {
        label: "unit(unit)",
        parameters: [
          {
            label: "number unit",
            documentation: "see description above",
          },
        ],
      },
    ],
  },
  {
    name: "squiz",
    detail: "squiz/superdirt,superdirtonly",
    documentation:
      'Made by Calum Gunn. Reminiscent of some weird mixture of filter, ring-modulator\nand pitch-shifter. The SuperCollider manual defines Squiz as:\n\n"A simplistic pitch-raising algorithm. It\'s not meant to sound natural; its\nsound is reminiscent of some weird mixture of filter, ring-modulator and\npitch-shifter, depending on the input. The algorithm works by cutting the signal\ninto fragments (delimited by upwards-going zero-crossings) and squeezing those\nfragments in the time domain (i.e. simply playing them back faster than they\ncame in), leaving silences inbetween. All the parameters apart from memlen can\nbe modulated."',
    signatures: [
      {
        label: "squiz(squiz)",
        parameters: [
          {
            label: "number squiz",
            documentation: "Try passing multiples of 2 to it - 2, 4, 8 etc.",
          },
        ],
      },
    ],
  },
  {
    name: "vowel",
    detail: "vowel/superdough",
    documentation: "Formant filter to make things sound like vowels.",
    signatures: [
      {
        label: "vowel(vowel)",
        parameters: [
          {
            label: "string vowel",
            documentation:
              "You can use a e i o u ae aa oe ue y uh un en an on, corresponding to [a] [e] [i]\n[o] [u] [æ] [ɑ] [ø] [y] [ɯ] [ʌ] [œ̃] [ɛ̃] [ɑ̃] [ɔ̃]. Aliases: aa = å = ɑ, oe = ø\n= ö, y = ı, ae = æ.",
          },
        ],
      },
    ],
  },
  {
    name: "density",
    detail: "density/superdough",
    documentation: "crackle noise density",
    signatures: [
      {
        label: "density(density)",
        parameters: [
          {
            label: "number density",
            documentation: "between 0 and x",
          },
        ],
      },
    ],
  },
  {
    name: "clip",
    detail: "clip/superdough",
    documentation:
      "Multiplies the duration with the given number. Also cuts samples off at the end\nif they exceed the duration.",
    signatures: [
      {
        label: "clip(factor)",
        parameters: [
          {
            label: "number factor",
            documentation: "> = 0",
          },
        ],
      },
    ],
  },
  {
    name: "duration",
    detail: "duration/superdough",
    documentation:
      "Sets the duration of the event in cycles. Similar to clip / legato, it also cuts\nsamples off at the end if they exceed the duration.",
    signatures: [
      {
        label: "duration(seconds)",
        parameters: [
          {
            label: "number seconds",
            documentation: "> = 0",
          },
        ],
      },
    ],
  },
  {
    name: "color",
    detail: "color/visualization",
    documentation:
      "Sets the color of the hap in visualizations like pianoroll or highlighting.",
    signatures: [
      {
        label: "color(color)",
        parameters: [
          {
            label: "string color",
            documentation: "Hexadecimal or CSS color name",
          },
        ],
      },
    ],
  },
  {
    name: "adsr",
    detail: "adsr/envelope,amplitude",
    documentation:
      "ADSR envelope: Combination of Attack, Decay, Sustain, and Release.",
    signatures: [
      {
        label: "adsr(time, time, gain, time)",
        parameters: [
          {
            label: "number time",
            documentation: "attack time in seconds",
          },
          {
            label: "number time",
            documentation: "decay time in seconds",
          },
          {
            label: "number gain",
            documentation: "sustain level (0 to 1)",
          },
          {
            label: "number time",
            documentation: "release time in seconds",
          },
        ],
      },
    ],
  },
  {
    name: "midichan",
    detail: "midichan/external_io,midi",
    documentation: "MIDI channel: Sets the MIDI channel for the event.",
    signatures: [
      {
        label: "midichan(channel)",
        parameters: [
          {
            label: "number channel",
            documentation: "MIDI channel number (0-15)",
          },
        ],
      },
    ],
  },
  {
    name: "midiport",
    detail: "midiport/external_io,midi",
    documentation: "MIDI port: Sets the MIDI port for the event.",
    signatures: [
      {
        label: "midiport(port)",
        parameters: [
          {
            label: "number port",
            documentation: "MIDI port",
          },
        ],
      },
    ],
  },
  {
    name: "midicmd",
    detail: "midicmd/external_io,midi",
    documentation: "MIDI command: Sends a MIDI command message.",
    signatures: [
      {
        label: "midicmd(command)",
        parameters: [
          {
            label: "number command",
            documentation: "MIDI command",
          },
        ],
      },
    ],
  },
  {
    name: "control",
    detail: "control/external_io,midi",
    documentation: "MIDI control: Sends a MIDI control change message.",
    signatures: [
      {
        label: "control(MIDI, MIDI)",
        parameters: [
          {
            label: "number MIDI",
            documentation: "control number (0-127)",
          },
          {
            label: "number MIDI",
            documentation: "controller value (0-127)",
          },
        ],
      },
    ],
  },
  {
    name: "ccn",
    detail: "ccn/external_io,midi",
    documentation: "MIDI control number: Sends a MIDI control change message.",
    signatures: [
      {
        label: "ccn(MIDI)",
        parameters: [
          {
            label: "number MIDI",
            documentation: "control number (0-127)",
          },
        ],
      },
    ],
  },
  {
    name: "ccv",
    detail: "ccv/external_io,midi",
    documentation: "MIDI control value: Sends a MIDI control change message.",
    signatures: [
      {
        label: "ccv(MIDI)",
        parameters: [
          {
            label: "number MIDI",
            documentation: "control value (0-127)",
          },
        ],
      },
    ],
  },
  {
    name: "nrpnn",
    detail: "nrpnn/external_io,midi",
    documentation:
      "MIDI NRPN non-registered parameter number: Sends a MIDI NRPN non-registered\nparameter number message.",
    signatures: [
      {
        label: "nrpnn(nrpnn)",
        parameters: [
          {
            label: "number nrpnn",
            documentation: "MIDI NRPN non-registered parameter number (0-127)",
          },
        ],
      },
    ],
  },
  {
    name: "nrpv",
    detail: "nrpv/external_io,midi",
    documentation:
      "MIDI NRPN non-registered parameter value: Sends a MIDI NRPN non-registered\nparameter value message.",
    signatures: [
      {
        label: "nrpv(nrpv)",
        parameters: [
          {
            label: "number nrpv",
            documentation: "MIDI NRPN non-registered parameter value (0-127)",
          },
        ],
      },
    ],
  },
  {
    name: "progNum",
    detail: "progNum/external_io",
    documentation: "MIDI program number: Sends a MIDI program change message.",
    signatures: [
      {
        label: "progNum(program)",
        parameters: [
          {
            label: "number program",
            documentation: "MIDI program number (0-127)",
          },
        ],
      },
    ],
  },
  {
    name: "sysex",
    detail: "sysex/external_io,midi",
    documentation: "MIDI sysex: Sends a MIDI sysex message.",
    signatures: [
      {
        label: "sysex(id, data)",
        parameters: [
          {
            label: "number id",
            documentation: "Sysex ID",
          },
          {
            label: "number data",
            documentation: "Sysex data",
          },
        ],
      },
    ],
  },
  {
    name: "sysexid",
    detail: "sysexid/external_io,midi",
    documentation: "MIDI sysex ID: Sends a MIDI sysex identifier message.",
    signatures: [
      {
        label: "sysexid(id)",
        parameters: [
          {
            label: "number id",
            documentation: "Sysex ID",
          },
        ],
      },
    ],
  },
  {
    name: "sysexdata",
    detail: "sysexdata/external_io,midi",
    documentation: "MIDI sysex data: Sends a MIDI sysex message.",
    signatures: [
      {
        label: "sysexdata(data)",
        parameters: [
          {
            label: "number data",
            documentation: "Sysex data",
          },
        ],
      },
    ],
  },
  {
    name: "midibend",
    detail: "midibend/external_io,midi",
    documentation: "MIDI pitch bend: Sends a MIDI pitch bend message.",
    signatures: [
      {
        label: "midibend(midibend)",
        parameters: [
          {
            label: "number midibend",
            documentation: "MIDI pitch bend (-1 - 1)",
          },
        ],
      },
    ],
  },
  {
    name: "miditouch",
    detail: "miditouch/external_io,midi",
    documentation:
      "MIDI key after touch: Sends a MIDI key after touch message.",
    signatures: [
      {
        label: "miditouch(miditouch)",
        parameters: [
          {
            label: "number miditouch",
            documentation: "MIDI key after touch (0-1)",
          },
        ],
      },
    ],
  },
  {
    name: "oschost",
    detail: "oschost/external_io",
    documentation:
      "The host to send open sound control messages to. Requires running the OSC\nbridge.",
    signatures: [
      {
        label: "oschost(oschost)",
        parameters: [
          {
            label: "string oschost",
            documentation: "e.g. 'localhost'",
          },
        ],
      },
    ],
  },
  {
    name: "oscport",
    detail: "oscport/external_io",
    documentation:
      "The port to send open sound control messages to. Requires running the OSC\nbridge.",
    signatures: [
      {
        label: "oscport(oscport)",
        parameters: [
          {
            label: "number oscport",
            documentation: "e.g. 57120",
          },
        ],
      },
    ],
  },
  {
    name: "as",
    detail: "as/combiners",
    documentation: "Sets properties in a batch.",
    signatures: [
      {
        label: "as(mapping)",
        parameters: [
          {
            label: "String mapping",
            documentation: "the control names that are set",
          },
        ],
      },
    ],
  },
  {
    name: "scrub",
    detail: "Pattern.scrub/samples",
    documentation:
      'Allows you to scrub an audio file like a tape loop by passing values that\nrepresents the position in the audio file in the optional array syntax ex:\n"0.5:2", the second value controls the speed of playback',
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
      'Configures an LFO. Can be called in sequence like pat.lfo(...).lfo(...) to set\nup multiple LFOs. There are two ways to declare which control will be modulated:\n\n 1. Explicitly put control in the config (e.g. lfo({ c: "lpf" }))\n 2. If the control parameter is absent, the control immediately before the lfo\n    call will be used (e.g. s("saw").lpf(500).lfo() to modulate lpf)\n\nModulators can be referred to by id so that they can be updated later e.g.\ninside a sometimes. See example below.',
    signatures: [
      {
        label:
          "lfo(config, config.control, config.subControl, config.rate, config.sync, config.depth, config.depthabs, config.dcoffset, config.shape, config.skew, config.curve, config.retrig, config.fxi, id)",
        parameters: [
          {
            label: "Object config",
            documentation: "LFO configuration.",
          },
          {
            label: "string config.control",
            documentation: "Node to modulate. Aliases: c",
          },
          {
            label: "string config.subControl",
            documentation:
              "Sub-control name to append to the control key. Aliases: sc",
          },
          {
            label: "number config.rate",
            documentation: "Modulation rate. Aliases: r",
          },
          {
            label: "number config.sync",
            documentation: "Tempo-synced modulation rate. Aliases: s",
          },
          {
            label: "number config.depth",
            documentation: "Relative modulation depth. Aliases: dep, dr",
          },
          {
            label: "number config.depthabs",
            documentation: "Absolute modulation depth. Aliases: da",
          },
          {
            label: "number config.dcoffset",
            documentation: "DC offset / bias for the waveform. Aliases: dc",
          },
          {
            label: "number config.shape",
            documentation: "Shape index. Aliases: sh",
          },
          {
            label: "number config.skew",
            documentation: "Skew amount. Aliases: sk",
          },
          {
            label: "number config.curve",
            documentation: "Exponential curve amount. Aliases: cu",
          },
          {
            label: "number config.retrig",
            documentation:
              "If > 0.5, the LFO will retrigger on each event. Aliases: rt",
          },
          {
            label: "number config.fxi",
            documentation: "FX index to target",
          },
          {
            label: "string id",
            documentation: "ID to use for this modulator",
          },
        ],
      },
    ],
  },
  {
    name: "env",
    detail: "env/envelope,superdough",
    documentation:
      'Configures an envelope. Can be called in sequence like pat.env(...).env(...) to\nset up multiple envelopes There are two ways to declare which control will be\nmodulated:\n\n 1. Explicitly put control in the config (e.g. env({ c: "lpf" }))\n 2. If the control parameter is absent, the control immediately before the env\n    call will be used (e.g. s("saw").lpf(500).env({ a: 1 }) to modulate lpf)\n\nModulators can be referred to by id so that they can be updated later e.g.\ninside a sometimes. See example below.',
    signatures: [
      {
        label:
          "env(config, config.control, config.subControl, config.depth, config.depthabs, config.attack, config.decay, config.sustain, config.release, config.acurve, config.dcurve, config.rcurve, config.fxi, id)",
        parameters: [
          {
            label: "Object config",
            documentation: "Envelope configuration.",
          },
          {
            label: "string config.control",
            documentation: "Node to modulate. Aliases: c",
          },
          {
            label: "string config.subControl",
            documentation:
              "Sub-control name to append to the control key. Aliases: sc",
          },
          {
            label: "number config.depth",
            documentation: "Relative modulation depth. Aliases: dep, dr",
          },
          {
            label: "number config.depthabs",
            documentation: "Absolute modulation depth. Aliases: da",
          },
          {
            label: "number config.attack",
            documentation: "Time to reach depth. Aliases: att, a",
          },
          {
            label: "number config.decay",
            documentation: "Time to reach sustain. Aliases: dec, d",
          },
          {
            label: "number config.sustain",
            documentation: "Sustain depth. Aliases: sus, s",
          },
          {
            label: "number config.release",
            documentation: "Time to return to nominal value. Aliases: rel, r",
          },
          {
            label: "number config.acurve",
            documentation:
              "Snappiness of attack curve (-1 = relaxed, 1 = snappy). Aliases: ac",
          },
          {
            label: "number config.dcurve",
            documentation:
              "Snappiness of decay curve (-1 = relaxed, 1 = snappy). Aliases: dc",
          },
          {
            label: "number config.rcurve",
            documentation:
              "Snappiness of release curve (-1 = relaxed, 1 = snappy). Aliases: rc",
          },
          {
            label: "number config.fxi",
            documentation: "FX index to target",
          },
          {
            label: "string id",
            documentation: "ID to use for this modulator",
          },
        ],
      },
    ],
  },
  {
    name: "bmod",
    detail: "bmod/superdough",
    documentation:
      'Modulates with the output from a given bus. Can be called in sequence like\npat.bmod(...).bmod(...) to set up multiple modulators\n\nSend to an audio bus with otherPat.bus(..).\n\nThere are two ways to declare which control will be modulated:\n\n 1. Explicitly put control in the config (e.g. bmod({ id: 2, c: "lpf" }))\n 2. If the control parameter is absent, the control immediately before the bmod\n    call will be used (e.g. s("saw").lpf(500).bmod({ id: 2 }) to modulate lpf)\n\nModulators can be referred to by id so that they can be updated later e.g.\ninside a sometimes. See example below.',
    signatures: [
      {
        label:
          "bmod(config, config.bus, config.control, config.subControl, config.depth, config.depthabs, config.dc, config.fxi, id)",
        parameters: [
          {
            label: "Object config",
            documentation: "Bus modulation configuration.",
          },
          {
            label: "string config.bus",
            documentation: "Bus to get modulation signal from",
          },
          {
            label: "string config.control",
            documentation: "Node to modulate. Aliases: c",
          },
          {
            label: "string config.subControl",
            documentation:
              "Sub-control name to append to the control key. Aliases: sc",
          },
          {
            label: "number config.depth",
            documentation: "Relative modulation depth. Aliases: dep, dr",
          },
          {
            label: "number config.depthabs",
            documentation: "Absolute modulation depth. Aliases: da",
          },
          {
            label: "number config.dc",
            documentation: "DC offset prior to application",
          },
          {
            label: "number config.fxi",
            documentation: "FX index to target",
          },
          {
            label: "string id",
            documentation: "ID to use for this modulator",
          },
        ],
      },
    ],
  },
  {
    name: "transient",
    detail: "transient/superdough",
    documentation:
      "Transient shaper. Gives independent control over the emphasis on transients and\nsustains",
    signatures: [
      {
        label: "transient(attack, sustain)",
        parameters: [
          {
            label: "number attack",
            documentation:
              "Emphasis on transients; between -1 (deaccentuate) and 1 (accentuate)",
          },
          {
            label: "number sustain",
            documentation:
              "Emphasis on the sustains; between -1 (deaccentuate) and 1 (accentuate)",
          },
        ],
      },
    ],
  },
  {
    name: "drawLine",
    detail: "drawLine/visualization",
    documentation:
      'Intended for a debugging, drawLine renders the pattern as a string, where each\ncharacter represents the same time span. Should only be used with single\ncharacters as values, otherwise the character slots will be messed up. Character\nlegend:\n\n * "|" cycle separator\n * "-" hold previous value\n * "." silence',
    signatures: [
      {
        label: "drawLine(pattern, chars)",
        parameters: [
          {
            label: "Pattern pattern",
            documentation: "the pattern to use",
          },
          {
            label: "number chars",
            documentation: "max number of characters (approximately)",
          },
        ],
      },
    ],
  },
  {
    name: "euclid",
    detail: "Pattern.euclid/temporal",
    documentation:
      "Changes the structure of the pattern to form an Euclidean rhythm. Euclidean\nrhythms are rhythms obtained using the greatest common divisor of two numbers.\nThey were described in 2004 by Godfried Toussaint, a Canadian computer\nscientist. Euclidean rhythms are really useful for computer/algorithmic music\nbecause they can describe a large number of rhythms with a couple of numbers.\n\nA negative number of pulses inverts the pattern so pulses happen in the gaps of\nthe normal euclidean rhythm.\n\nA negative number of steps changes it into euclidLegato.",
    signatures: [
      {
        label: "euclid(pulses, steps)",
        parameters: [
          {
            label: "number pulses",
            documentation: "the number of onsets/beats",
          },
          {
            label: "number steps",
            documentation: "the number of steps to fill",
          },
        ],
      },
    ],
  },
  {
    name: "euclidRot",
    detail: "Pattern.euclidRot/temporal",
    documentation:
      "Like euclid, but has an additional parameter for 'rotating' the resulting\nsequence.",
    signatures: [
      {
        label: "euclidRot(pulses, steps, rotation)",
        parameters: [
          {
            label: "number pulses",
            documentation: "the number of onsets/beats",
          },
          {
            label: "number steps",
            documentation: "the number of steps to fill",
          },
          {
            label: "number rotation",
            documentation: "offset in steps",
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
      "Similar to euclid, but each pulse is held until the next pulse, so there will be\nno gaps.\n\nA negative number of steps changes it into euclid.",
    signatures: [
      {
        label: "euclidLegato(pulses, steps, rotation, pat)",
        parameters: [
          {
            label: "number pulses",
            documentation: "the number of onsets/beats",
          },
          {
            label: "number steps",
            documentation: "the number of steps to fill",
          },
          {
            label: "undefined rotation",
            documentation: "offset in steps",
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
      "Similar to euclid, but each pulse is held until the next pulse, so there will be\nno gaps, and has an additional parameter for 'rotating' the resulting sequence.\n\nA negative number of steps changes it into euclidRot.",
    signatures: [
      {
        label: "euclidLegatoRot(pulses, steps, rotation)",
        parameters: [
          {
            label: "number pulses",
            documentation: "the number of onsets/beats",
          },
          {
            label: "number steps",
            documentation: "the number of steps to fill",
          },
          {
            label: "number rotation",
            documentation: "offset in steps",
          },
        ],
      },
    ],
  },
  {
    name: "euclidish",
    detail: "Pattern.euclidish/temporal",
    documentation:
      'A \'euclid\' variant with an additional parameter that morphs the resulting rhythm\nfrom 0 (no morphing) to 1 (completely \'even\'). For example\nsound("bd").euclidish(3,8,0) would be the same as sound("bd").euclid(3,8), and\nsound("bd").euclidish(3,8,1) would be the same as sound("bd bd bd").\nsound("bd").euclidish(3,8,0.5) would have a groove somewhere between. Inspired\nby the work of Malcom Braff.',
    signatures: [
      {
        label: "euclidish(pulses, steps, groove)",
        parameters: [
          {
            label: "number pulses",
            documentation: "the number of onsets",
          },
          {
            label: "number steps",
            documentation: "the number of steps to fill",
          },
          {
            label: "number groove",
            documentation:
              "exists between the extremes of 0 (straight euclidian) and 1 (straight pulse)",
          },
        ],
      },
    ],
  },
  {
    name: "Pattern",
    detail: "Pattern/noautocomplete",
    documentation:
      "Create a pattern. As an end user, you will most likely not create a Pattern\ndirectly.",
    signatures: [
      {
        label: "Pattern(query)",
        parameters: [
          {
            label: "function query",
            documentation: "The function that maps a State to an array of Hap.",
          },
        ],
      },
    ],
  },
  {
    name: "withValue",
    detail: "Pattern#withValue/functional",
    documentation:
      "Returns a new pattern, with the function applied to the value of each hap. It\nhas the alias fmap.",
    signatures: [
      {
        label: "withValue(func)",
        parameters: [
          {
            label: "function func",
            documentation: "to to apply to the value",
          },
        ],
      },
    ],
  },
  {
    name: "fmap",
    detail: "Pattern#fmap/noautocomplete",
    documentation: "see withValue",
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
      "Assumes 'this' is a pattern of functions, and given a function to resolve\nwholes, applies a given pattern of values to that pattern of functions.",
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
      "When this method is called on a pattern of functions, it matches its haps with\nthose in the given pattern of values. A new pattern is returned, with each\nmatching value applied to the corresponding function.\n\nIn this _appBoth variant, where timespans of the function and value haps are not\nthe same but do intersect, the resulting hap has a timespan of the intersection.\nThis applies to both the part and the whole timespan.",
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
      "As with appBoth, but the whole timespan is not the intersection, but the\ntimespan from the function of patterns that this method is called on. In\npractice, this means that the pattern structure, including onsets, are preserved\nfrom the pattern of functions (often referred to as the left hand or inner\npattern).",
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
      "As with appLeft, but whole timespans are instead taken from the pattern of\nvalues, i.e. structure is preserved from the right hand/outer pattern.",
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
    documentation: "Query haps inside the given time span.",
    signatures: [
      {
        label: "queryArc(begin, end)",
        parameters: [
          {
            label: "Fraction begin",
            documentation: "from time",
          },
          {
            label: "Fraction end",
            documentation: "to time",
          },
        ],
      },
    ],
  },
  {
    name: "splitQueries",
    detail: "Pattern#splitQueries/internals,noautocomplete",
    documentation:
      "Returns a new pattern, with queries split at cycle boundaries. This makes some\ncalculations easier to express, as all haps are then constrained to happen\nwithin a cycle.",
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
      "Returns a new pattern, where the given function is applied to the query timespan\nbefore passing it to the original pattern.",
    signatures: [
      {
        label: "withQuerySpan(func)",
        parameters: [
          {
            label: "function func",
            documentation: "the function to apply",
          },
        ],
      },
    ],
  },
  {
    name: "withQueryTime",
    detail: "Pattern#withQueryTime/internals,noautocomplete",
    documentation:
      "As with withQuerySpan, but the function is applied to both the begin and end\ntime of the query timespan.",
    signatures: [
      {
        label: "withQueryTime(func)",
        parameters: [
          {
            label: "function func",
            documentation: "the function to apply",
          },
        ],
      },
    ],
  },
  {
    name: "withHapSpan",
    detail: "Pattern#withHapSpan/internals,noautocomplete",
    documentation:
      "Similar to withQuerySpan, but the function is applied to the timespans of all\nhaps returned by pattern queries (both part timespans, and where present, whole\ntimespans).",
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
      "As with withHapSpan, but the function is applied to both the begin and end time\nof the hap timespans.",
    signatures: [
      {
        label: "withHapTime(func)",
        parameters: [
          {
            label: "function func",
            documentation: "the function to apply",
          },
        ],
      },
    ],
  },
  {
    name: "withHaps",
    detail: "Pattern#withHaps/internals,noautocomplete",
    documentation:
      "Returns a new pattern with the given function applied to the list of haps\nreturned by every query.\n\nAs an end user, you will most likely not need to use this; look at withContext,\nwithHapSpan, etc. instead.",
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
      "As with withHaps, but applies the function to every hap, rather than every list\nof haps.\n\nAs an end user, you will most likely not need to use this; look at withContext,\nwithHapSpan, etc. instead.",
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
      "Returns a new pattern with the context field set to every hap set to the given\nvalue.",
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
      "Returns a new pattern with the given function applied to the context field of\nevery hap.",
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
      "Returns a new pattern with the context field of every hap set to an empty\nobject.",
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
      "Returns a new pattern with the given location information added to the context\nof every hap.",
    signatures: [
      {
        label: "withLoc(start, end)",
        parameters: [
          {
            label: "Number start",
            documentation: "start offset",
          },
          {
            label: "Number end",
            documentation: "end offset",
          },
        ],
      },
    ],
  },
  {
    name: "filterHaps",
    detail: "Pattern#filterHaps/internals",
    documentation:
      "Returns a new Pattern, which only returns haps that meet the given test.",
    signatures: [
      {
        label: "filterHaps(hap_test)",
        parameters: [
          {
            label: "function hap_test",
            documentation:
              "a function which returns false for haps to be removed from the pattern",
          },
        ],
      },
    ],
  },
  {
    name: "filterValues",
    detail: "Pattern#filterValues/internals",
    documentation:
      "As with filterHaps, but the function is applied to values inside haps.",
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
      "Returns a new pattern, with haps containing undefined values removed from query\nresults.",
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
      "Returns a new pattern, with all haps without onsets filtered out. A hap with an\nonset is one with a whole timespan that begins at the same time as its part\ntimespan.",
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
      "Returns a new pattern, with 'continuous' haps (those without 'whole' timespans)\nremoved from query results.",
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
      "Combines adjacent haps with the same value and whole. Only intended for use in\ntests.",
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
      "Queries the pattern for the first cycle, returning Haps. Mainly of use when\ndebugging a pattern.",
    signatures: [
      {
        label: "firstCycle(with_context)",
        parameters: [
          {
            label: "Boolean with_context",
            documentation:
              "set to true, otherwise the context field will be stripped from the resulting\nhaps.",
          },
        ],
      },
    ],
  },
  {
    name: "firstCycleValues",
    detail: "Pattern#firstCycleValues/internals,noautocomplete",
    documentation:
      "Accessor for a list of values returned by querying the first cycle.",
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
      "More human-readable version of the firstCycleValues accessor.",
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
      "Returns a new pattern, which returns haps sorted in temporal order. Mainly of\nuse when comparing two patterns for equality, in tests.",
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
    documentation: "Returns a new pattern with all values parsed as numerals.",
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
      "Layers the result of the given function(s). Like superimpose, but without the\noriginal pattern:",
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
      "Superimposes the result of the given function(s) on top of the original pattern:",
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
    documentation: "Attaches a function that is called for each hap onset.",
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
      "Writes the content of the current event to the console (visible in the side\nmenu).",
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
      'A simplified version of log which writes all "values" (various configurable\nparameters) within the event to the console (visible in the side menu).',
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
      "Breaks a pattern into pieces according to the structure of a given pattern. True\nvalues in the given pattern cause the corresponding subcycle of the source\npattern to be looped, and for an (optional) given function to be applied. False\nvalues result in the corresponding part of the source pattern to be played\nunchanged.",
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
    documentation: "Selects indices in in stacked notes.",
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
    documentation: "Selects indices in in stacked notes.",
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
      "When called on a pattern a, with a input pattern b (a.set(b)), combines a and b\nsuch that anything defined in b and anything defined in a that is not defined in\nb will be in the resulting pattern.\n\nThe structure is maintained from a, because the default pattern alignment is in,\nsee the section on Pattern Alignment in the technical manual in the docs\n\nThis is the inverse of keep\n\nSee examples below",
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
      "When called on a pattern a, with a input pattern b (a.keep(b)), combines a and b\nsuch that anything defined in a, and anything defined in b that is not defined\nin a will be in the resulting pattern\n\nThe structure is maintained from a, because the default pattern alignment is in,\nsee the section on Pattern Alignment in the technical manual in the docs\n\nThis is the inverse of set\n\nSee examples below",
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
      "Assumes a pattern of numbers. Adds the given number to each item in the pattern.",
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
    documentation: "Like add, but the given numbers are subtracted.",
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
    documentation: "Multiplies each number by the given factor.",
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
    documentation: "Divides each number by the given factor.",
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
      "Divides each number by the given factor and returns the remainder",
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
    documentation: "Raises each number to the power of the given factor",
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
    documentation: "Performs a bitwise and on each number and the given factor",
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
    documentation: "Performs a bitwise or on each number and the given factor",
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
    documentation: "Performs a bitwise xor on each number and the given factor",
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
      "Performs a bitwise left shift on each number by the given factor",
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
      "Performs a bitwise right shift on each number by the given factor",
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
    documentation: "performs a < b",
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
    documentation: "performs a > b",
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
    documentation: "performs a <= b",
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
    documentation: "performs a >= b",
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
    documentation: "performs a == b",
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
    documentation: "performs a === b (strictly equal)",
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
    documentation: "performs a != b",
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
    documentation: "performs a !== b (strictly not equal)",
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
    documentation: "performs a && b",
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
    documentation: "performs a || b",
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
    documentation: "Applies the given structure to the pattern:",
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
    documentation: 'Returns silence when mask is 0 or "~"',
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
      "Resets the pattern to the start of the cycle for each onset of the reset\npattern.",
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
      "Restarts the pattern for each onset of the restart pattern. While reset will\nonly reset the current cycle, restart will start from cycle 0.",
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
      "Sets the default method of combining events from two patterns (aka alignment\n[https://strudel.cc/technical-manual/alignment/]) in Strudel. The default method\nis 'in', meaning that patterns to the left will (typically) dictate the event\ntimings when combined with patterns to the right. By changing alignment to\n'out', the opposite will happen. With 'mix', they will combine their event\ntimings.\n\nNote that we say the default method, because alignments can also be set\nexplicitly with calls like 'add.mix', 'set.squeeze', etc.",
    signatures: [
      {
        label: "setDefaultJoin(method)",
        parameters: [
          {
            label: "string method",
            documentation:
              "Default join method to use. Options: 'in', 'out', 'mix', 'squeeze',\n'squeezeout', 'reset', 'restart', 'poly'",
          },
        ],
      },
    ],
  },
  {
    name: "gap",
    detail: "gap/generators",
    documentation: "Does absolutely nothing, but with a given metrical 'steps'",
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
    documentation: "Does absolutely nothing..",
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
    documentation: "A discrete value that repeats once per cycle.",
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
    documentation: "Takes a list of patterns, and returns a pattern of lists.",
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
      "The given items are played at the same time at the same length.",
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
      "The input patterns are aligned to the left, with silence padded to the shorter\npattern(s) in the final steps if there's a stepcount disparity. See also\nstackRight and stackCenter/stackCentre",
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
      "The input patterns are aligned to the right, with silence padded to the shorter\npattern(s) in the initial steps if there's a stepcount disparity. See also\nstackLeft and stackCenter/stackCentre",
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
      "The input patterns are aligned to the right, with silence padded to the shorter\npattern(s) in the initial steps if there's a stepcount disparity. See also\nstackLeft and stackRight",
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
      "Shorthand for pm(patterns).pace(m) where m is the max step count in the input\npatterns",
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
      "Concatenation: combines a list of patterns, switching between them successively,\none per cycle.",
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
      "Concatenation: combines a list of patterns, switching between them successively,\none per cycle. Unlike slowcat, this version will skip cycles.",
    signatures: [
      {
        label: "slowcatPrime(items)",
        parameters: [
          {
            label: "any items",
            documentation: "The items to concatenate",
          },
        ],
      },
    ],
  },
  {
    name: "cat",
    detail: "cat/combiners",
    documentation:
      "The given items are concatenated, where each one takes one cycle.",
    signatures: [
      {
        label: "cat(items)",
        parameters: [
          {
            label: "any items",
            documentation: "The items to concatenate",
          },
        ],
      },
    ],
  },
  {
    name: "arrange",
    detail: "arrange/combiners",
    documentation:
      "Allows to arrange multiple patterns together over multiple cycles. Takes a\nvariable number of arrays with two elements specifying the number of cycles and\nthe pattern to use.",
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
      "Similarly to arrange, allows you to arrange multiple patterns together over\nmultiple cycles. Unlike arrange, you specify a start and stop time for each\npattern rather than duration, which means that patterns can overlap.",
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
    documentation: "See fastcat",
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
    documentation: "Like cat, but the items are crammed into one cycle.",
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
      "Registers a new pattern method. The method is added to the Pattern class + the\nstandalone function is returned from register.",
    signatures: [
      {
        label: "register(name, func, patternify)",
        parameters: [
          {
            label: "string name",
            documentation:
              "name of the function, or an array of names to be used as synonyms",
          },
          {
            label: "function func",
            documentation:
              "function with 1 or more params, where last is the current pattern",
          },
          {
            label: "bool patternify",
            documentation:
              "defaults to true; if set to false, you will have more control over the arguments\nto func as they will be in their raw form and it will be up to you to patternify\nthem and/or query them for values",
          },
        ],
      },
    ],
  },
  {
    name: "round",
    detail: "Pattern.round/math",
    documentation:
      "Assumes a numerical pattern. Returns a new pattern with all values rounded to\nthe nearest integer.",
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
      "Assumes a numerical pattern. Returns a new pattern with all values set to their\nmathematical floor. E.g. 3.7 replaced with to 3, and -4.2 replaced with -5.",
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
      "Assumes a numerical pattern. Returns a new pattern with all values set to their\nmathematical ceiling. E.g. 3.2 replaced with 4, and -4.2 replaced with -4.",
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
      "Assumes a numerical pattern, containing unipolar values in the range 0 ..\n\n 1. Returns a new pattern with values scaled to the bipolar range -1 .. 1",
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
      "Assumes a numerical pattern, containing bipolar values in the range -1 .. 1\nReturns a new pattern with values scaled to the unipolar range 0 .. 1",
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
      "Assumes a numerical pattern, containing unipolar values in the range 0 .. 1.\nReturns a new pattern with values scaled to the given min/max range. Most useful\nin combination with continuous patterns.",
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
      "Assumes a numerical pattern, containing unipolar values in the range 0 .. 1\nReturns a new pattern with values scaled to the given min/max range, following\nan exponential curve.",
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
      "Assumes a numerical pattern, containing bipolar values in the range -1 .. 1\nReturns a new pattern with values scaled to the given min/max range.",
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
      'Allows dividing numbers via list notation using ":". Returns a new pattern with\njust numbers.',
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
    documentation: "Compress each cycle into the given timespan, leaving a gap",
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
      'speeds up a pattern like fast, but rather than it playing multiple times as fast\nwould it instead leaves a gap in the remaining space of the cycle. For example,\nthe following will play the sound pattern "bd sn" only once but compressed into\nthe first half of the cycle, i.e. twice as fast.',
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
      "Similar to compress, but doesn't leave gaps, and the 'focus' can be bigger than\na cycle",
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
      "The ply function repeats each event the given number of times.",
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
      'Speed up a pattern by the given factor. Used by "*" in mini notation.',
    signatures: [
      {
        label: "fast(factor)",
        parameters: [
          {
            label: "number factor",
            documentation: "speed up factor",
          },
        ],
      },
    ],
  },
  {
    name: "hurry",
    detail: "hurry/temporal",
    documentation:
      "Both speeds up the pattern (like 'fast') and the sample playback (like 'speed').",
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
      'Slow down a pattern over the given number of cycles. Like the "/" operator in\nmini notation.',
    signatures: [
      {
        label: "slow(factor)",
        parameters: [
          {
            label: "number factor",
            documentation: "slow down factor",
          },
        ],
      },
    ],
  },
  {
    name: "inside",
    detail: "inside/temporal",
    documentation: "Carries out an operation 'inside' a cycle.",
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
    documentation: "Carries out an operation 'outside' a cycle.",
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
      "Applies the given function every n cycles, starting from the last cycle.",
    signatures: [
      {
        label: "lastOf(n, func)",
        parameters: [
          {
            label: "number n",
            documentation: "how many cycles",
          },
          {
            label: "function func",
            documentation: "function to apply",
          },
        ],
      },
    ],
  },
  {
    name: "firstOf",
    detail: "Pattern.firstOf/temporal",
    documentation:
      "Applies the given function every n cycles, starting from the first cycle.",
    signatures: [
      {
        label: "firstOf(n, func)",
        parameters: [
          {
            label: "number n",
            documentation: "how many cycles",
          },
          {
            label: "function func",
            documentation: "function to apply",
          },
        ],
      },
    ],
  },
  {
    name: "every",
    detail: "Pattern.every/temporal",
    documentation: "An alias for firstOf",
    signatures: [
      {
        label: "every(n, func)",
        parameters: [
          {
            label: "number n",
            documentation: "how many cycles",
          },
          {
            label: "function func",
            documentation: "function to apply",
          },
        ],
      },
    ],
  },
  {
    name: "apply",
    detail: "apply/combiners",
    documentation:
      "Applies the given function to the pattern. Like layer, but with a single\nfunction:",
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
    documentation: "Plays the pattern at the given cycles per minute.",
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
      "Nudge a pattern to start earlier in time. Equivalent of Tidal's <~ operator",
    signatures: [
      {
        label: "early(cycles)",
        parameters: [
          {
            label: "number cycles",
            documentation: "number of cycles to nudge left",
          },
        ],
      },
    ],
  },
  {
    name: "late",
    detail: "Pattern.late/temporal",
    documentation:
      "Nudge a pattern to start later in time. Equivalent of Tidal's ~> operator",
    signatures: [
      {
        label: "late(cycles)",
        parameters: [
          {
            label: "number cycles",
            documentation: "number of cycles to nudge right",
          },
        ],
      },
    ],
  },
  {
    name: "zoom",
    detail: "zoom/temporal",
    documentation:
      "Plays a portion of a pattern, specified by the beginning and end of a time span.\nThe new resulting pattern is played over the time period of the original\npattern:",
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
      "Splits a pattern into the given number of slices, and plays them according to a\npattern of slice numbers. Similar to slice, but slices up patterns rather than\nsound samples.",
    signatures: [
      {
        label: "bite(number, slices)",
        parameters: [
          {
            label: "number number",
            documentation: "of slices",
          },
          {
            label: "number slices",
            documentation: "to play",
          },
        ],
      },
    ],
  },
  {
    name: "isobite",
    detail: "Pattern.isobite/temporal",
    documentation:
      "Similar to struct, but every hap in the structure pattern plays the next cycle\nof the main pattern. With a different number of cycles in the main pattern and\nhaps in the structure pattern, this creates an isorhythm.\n\nNote: This function works on the assumption that the structure pattern repeats\nevery cycle. If the structure pattern only repeats after multiple cycles, it may\nskip or repeat certain parts of the melody.",
    signatures: [
      {
        label: "isobite(structure)",
        parameters: [
          {
            label: "Pattern structure",
            documentation: "structure of the pattern",
          },
        ],
      },
    ],
  },
  {
    name: "linger",
    detail: "linger/temporal",
    documentation:
      "Selects the given fraction of the pattern and repeats that part to fill the\nremainder of the cycle.",
    signatures: [
      {
        label: "linger(fraction)",
        parameters: [
          {
            label: "number fraction",
            documentation: "fraction to select",
          },
        ],
      },
    ],
  },
  {
    name: "segment",
    detail: "segment/temporal",
    documentation:
      "Samples the pattern at a rate of n events per cycle. Useful for turning a\ncontinuous pattern into a discrete one.",
    signatures: [
      {
        label: "segment(segments)",
        parameters: [
          {
            label: "number segments",
            documentation: "number of segments per cycle",
          },
        ],
      },
    ],
  },
  {
    name: "swingBy",
    detail: "swingBy/temporal",
    documentation:
      "The function swingBy x n breaks each cycle into n slices, and then delays events\nin the second half of each slice by the amount x, which is relative to the size\nof the (half) slice. So if x is 0 it does nothing, 0.5 delays for half the note\nduration, and 1 will wrap around to doing nothing again. The end result is a\nshuffle or swing-like rhythm",
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
    documentation: "Shorthand for swingBy with 1/3:",
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
    documentation: "Swaps 1s and 0s in a binary pattern.",
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
      "Applies the given function whenever the given pattern is in a true state.",
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
      "Superimposes the function result on top of the original pattern, delayed by the\ngiven time.",
    signatures: [
      {
        label: "off(time, func)",
        parameters: [
          {
            label: "Pattern time",
            documentation: "offset time",
          },
          {
            label: "function func",
            documentation: "function to apply",
          },
        ],
      },
    ],
  },
  {
    name: "brak",
    detail: "Pattern.brak/temporal",
    documentation:
      "Returns a new pattern where every other cycle is played once, twice as fast, and\noffset in time by one quarter of a cycle. Creates a kind of breakbeat feel.",
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
      "Reverse all cycles in a pattern. See also revv for reversing a whole pattern.",
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
      "Reverse a whole pattern. See also rev for reversing each cycle.",
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
      "Like press, but allows you to specify the amount by which each event is shifted.\npressBy(0.5) is the same as press, while pressBy(1/3) shifts each event by a\nthird of its timespan.",
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
      "Syncopates a rhythm, by shifting each event halfway into its timespan.",
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
    documentation: "Silences a pattern.",
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
      "Applies rev to a pattern every other cycle, so that the pattern alternates\nbetween forwards and backwards.",
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
      "Jux with adjustable stereo width. 0 = mono, 1 = full stereo.",
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
    documentation: "Like juxBy, except it flips the ears each cycle.",
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
      "The jux function creates strange stereo effects, by applying a function to a\npattern, but only in the right-hand channel.",
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
    documentation: "Like jux, but flips the ears each cycle.",
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
      "Superimpose and offset multiple times, applying the given function each time.",
    signatures: [
      {
        label: "echoWith(times, time, func)",
        parameters: [
          {
            label: "number times",
            documentation: "how many times to repeat",
          },
          {
            label: "number time",
            documentation: "cycle offset between iterations",
          },
          {
            label: "function func",
            documentation:
              "function to apply, given the pattern and the iteration index",
          },
        ],
      },
    ],
  },
  {
    name: "echo",
    detail: "Pattern.echo/temporal",
    documentation:
      "Superimpose and offset multiple times, gradually decreasing the velocity",
    signatures: [
      {
        label: "echo(times, time, feedback)",
        parameters: [
          {
            label: "number times",
            documentation: "how many times to repeat",
          },
          {
            label: "number time",
            documentation: "cycle offset between iterations",
          },
          {
            label: "number feedback",
            documentation: "velocity multiplicator for each iteration",
          },
        ],
      },
    ],
  },
  {
    name: "stut",
    detail: "stut/temporal",
    documentation:
      "Deprecated. Like echo, but the last 2 parameters are flipped.",
    signatures: [
      {
        label: "stut(times, feedback, time)",
        parameters: [
          {
            label: "number times",
            documentation: "how many times to repeat",
          },
          {
            label: "number feedback",
            documentation: "velocity multiplicator for each iteration",
          },
          {
            label: "number time",
            documentation: "cycle offset between iterations",
          },
        ],
      },
    ],
  },
  {
    name: "plyWith",
    detail: "plyWith/temporal",
    documentation:
      "The plyWith function repeats each event the given number of times, applying the\ngiven function to each event.\\n",
    signatures: [
      {
        label: "plyWith(factor, func)",
        parameters: [
          {
            label: "number factor",
            documentation: "how many times to repeat",
          },
          {
            label: "function func",
            documentation: "function to apply, given the pattern",
          },
        ],
      },
    ],
  },
  {
    name: "plyForEach",
    detail: "plyForEach/temporal",
    documentation:
      "The plyForEach function repeats each event the given number of times, applying\nthe given function to each event. This version of ply uses the iteration index\nas an argument to the function, similar to echoWith.",
    signatures: [
      {
        label: "plyForEach(factor, func)",
        parameters: [
          {
            label: "number factor",
            documentation: "how many times to repeat",
          },
          {
            label: "function func",
            documentation:
              "function to apply, given the pattern and the iteration index",
          },
        ],
      },
    ],
  },
  {
    name: "iter",
    detail: "Pattern.iter/temporal",
    documentation:
      "Divides a pattern into a given number of subdivisions, plays the subdivisions in\norder, but increments the starting subdivision each cycle. The pattern wraps to\nthe first subdivision after the last subdivision is played.",
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
      "Like iter, but plays the subdivisions in reverse order. Known as iter' in\ntidalcycles",
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
    documentation: "Repeats each cycle the given number of times.",
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
      "Divides a pattern into a given number of parts, then cycles through those parts\nin turn, applying the given function to each part in turn (one part per cycle).",
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
      "Like chunk, but cycles through the parts in reverse order. Known as chunk' in\ntidalcycles",
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
      "Like chunk, but the cycles of the source pattern aren't repeated for each set of\nchunks.",
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
      "Like chunk, but the function is applied to a looped subcycle of the source\npattern.",
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
    documentation: "Like chunkInto, but moves backwards through the chunks.",
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
      "Loops the pattern inside an offset for cycles. If you think of the entire span\nof time in cycles as a ribbon, you can cut a single piece and loop it.",
    signatures: [
      {
        label: "ribbon(offset, cycles)",
        parameters: [
          {
            label: "number offset",
            documentation: "start point of loop in cycles",
          },
          {
            label: "number cycles",
            documentation: "loop length in cycles",
          },
        ],
      },
    ],
  },
  {
    name: "hsla",
    detail: "hsla/visualization",
    documentation:
      "Sets the pattern's color to the given hsla\n[https://www.w3schools.com/htmL/html_colors_hsl.asp]",
    signatures: [
      {
        label: "hsla(hue, saturation, lightness, alpha)",
        parameters: [
          {
            label: "Number hue",
            documentation: "(0 - 360)",
          },
          {
            label: "Number saturation",
            documentation: "percentage (0 - 100)",
          },
          {
            label: "Number lightness",
            documentation: "percentage (0 - 100)",
          },
          {
            label: "Number alpha",
            documentation: "(transparency) (0.0 - 1.0)",
          },
        ],
      },
    ],
  },
  {
    name: "hsl",
    detail: "hsl/visualization",
    documentation:
      "Sets the pattern's color to the given hsl\n[https://www.w3schools.com/htmL/html_colors_hsl.asp]",
    signatures: [
      {
        label: "hsl(hue, saturation, lightness)",
        parameters: [
          {
            label: "Number hue",
            documentation: "(0 - 360)",
          },
          {
            label: "Number saturation",
            documentation: "percentage (0 - 100)",
          },
          {
            label: "Number lightness",
            documentation: "percentage (0 - 100)",
          },
        ],
      },
    ],
  },
  {
    name: "tag",
    detail: "tag/temporal",
    documentation:
      "Tags each Hap with an identifier. Good for filtering. The function populates\nHap.context.tags (Array).",
    signatures: [
      {
        label: "tag(tag)",
        parameters: [
          {
            label: "string tag",
            documentation: "anything unique",
          },
        ],
      },
    ],
  },
  {
    name: "filter",
    detail: "filter/temporal,functional",
    documentation: "Filters haps using the given function",
    signatures: [
      {
        label: "filter(test)",
        parameters: [
          {
            label: "function test",
            documentation: "function to test Hap",
          },
        ],
      },
    ],
  },
  {
    name: "filterWhen",
    detail: "filterWhen/temporal,functional",
    documentation: "Filters haps by their begin time",
    signatures: [
      {
        label: "filterWhen(test)",
        parameters: [
          {
            label: "function test",
            documentation: "function to test Hap.whole.begin",
          },
        ],
      },
    ],
  },
  {
    name: "within",
    detail: "within/temporal,functional",
    documentation:
      "Use within to apply a function to only a part of a pattern.",
    signatures: [
      {
        label: "within(start, end, func)",
        parameters: [
          {
            label: "number start",
            documentation: "start within cycle (0 - 1)",
          },
          {
            label: "number end",
            documentation: "end within cycle (0 - 1). Must be > start",
          },
          {
            label: "function func",
            documentation: "function to be applied to the sub-pattern",
          },
        ],
      },
    ],
  },
  {
    name: "pace",
    detail: "pace/stepwise",
    documentation:
      "Experimental\n\nSpeeds a pattern up or down, to fit to the given number of steps per cycle.",
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
      "Experimental\n\nAligns the steps of the patterns, creating polymeters. The patterns are repeated\nuntil they all fit the cycle. For example, in the below the first pattern is\nrepeated twice, and the second is repeated three times, to fit the lowest common\nmultiple of six steps.",
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
      "'Concatenates' patterns like fastcat, but proportional to a number of steps per\ncycle. The steps can either be inferred from the pattern, or provided as a\n[length, pattern] pair. Has the alias timecat.",
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
      "Experimental\n\nConcatenates patterns stepwise, according to an inferred 'steps per cycle'.\nSimilar to stepcat, but if an argument is a list, the whole pattern will\nalternate between the elements in the list.",
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
      "Experimental\n\nTakes the given number of steps from a pattern (dropping the rest). A positive\nnumber will take steps from the start of a pattern, and a negative number from\nthe end.",
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
      "Experimental\n\nDrops the given number of steps from a pattern. A positive number will drop\nsteps from the start of a pattern, and a negative number from the end.",
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
      'Experimental\n\nextend is similar to fast in that it increases its density, but it also\nincreases the step count accordingly. So stepcat("a b".extend(2), "c d") would\nbe the same as "a b a b c d", whereas stepcat("a b".fast(2), "c d") would be the\nsame as "[a b] [a b] c d".',
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
      'Experimental\n\nreplicate is similar to extend, except that replicate will "replicate" the thing\nbeing extended. This will only differ from extend when the input pattern differs\nfrom cycle to cycle.',
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
      "Experimental\n\nExpands the step size of the pattern by the given factor.",
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
      "Experimental\n\nContracts the step size of the pattern by the given factor. See also expand.",
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
      "Experimental\n\nProgressively shrinks the pattern by 'n' steps until there's nothing left, or if\na second value is given (using mininotation list syntax with :), that number of\ntimes. A positive number will progressively drop steps from the start of a\npattern, and a negative number from the end.",
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
      "Experimental\n\nProgressively grows the pattern by 'n' steps until the full pattern is played,\nor if a second value is given (using mininotation list syntax with :), that\nnumber of times. A positive number will progressively grow steps from the start\nof a pattern, and a negative number from the end.",
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
      "Experimental\n\nInserts a pattern into a list of patterns. On the first repetition it will be\ninserted at the end of the list, then moved backwards through the list on\nsuccessive repetitions. The patterns are added together stepwise, with all\nrepetitions taking place over a single cycle. Using pace to set the number of\nsteps per cycle is therefore usually recommended.",
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
      "Experimental\n\n'zips' together the steps of the provided patterns. This can create a long\nrepetition, taking place over a single, dense cycle. Using pace to set the\nnumber of steps per cycle is therefore usually recommended.",
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
    documentation: "Aliases for stepcat",
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
      "Cuts each sample into the given number of parts, allowing you to explore a\ntechnique known as 'granular synthesis'. It turns a pattern of samples into a\npattern of parts of samples.",
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
      "Cuts each sample into the given number of parts, triggering progressive portions\nof each sample at each loop.",
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
      "Makes the sample fit the given number of cycles by changing the speed.",
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
      "Chops samples into the given number of slices, triggering those slices with a\ngiven pattern of slice numbers. Instead of a number, it also accepts a list of\nnumbers from 0 to 1 to slice at specific points.",
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
      "make something happen on event time uses browser timeout which is innacurate for\naudio tasks",
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
      "Works the same as slice, but changes the playback speed of each slice to match\nthe duration of its step.",
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
      "Makes the sample fit its event duration. Good for rhythmical loops like drum\nbreaks. Similar to loopAt.",
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
      "Makes the sample fit the given number of cycles and cps value, by changing the\nspeed. deprecated: use loopAt or fit instead, together with setCps / setCpm.",
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
      "exposes a custom value at query time. basically allows mutating state without\nevaluation",
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
      "Cross-fades between left and right from 0 to 1:\n\n * 0 = (full left, no right)\n * .5 = (both equal)\n * 1 = (no left, full right)",
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
      "creates a structure pattern from divisions of a cycle especially useful for\ncreating rhythms",
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
      "Takes two binary rhythms represented as lists of 1s and 0s, and a number between\n0 and 1 that morphs between them. The two lists should contain the same number\nof true values.",
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
    documentation: "Soft-clipping distortion",
    signatures: [
      {
        label: "soft(distortion, volume)",
        parameters: [
          {
            label: "number distortion",
            documentation: "amount of distortion to apply",
          },
          {
            label: "number volume",
            documentation: "linear postgain of the distortion",
          },
        ],
      },
    ],
  },
  {
    name: "hard",
    detail: "hard/distortion,superdough",
    documentation: "Hard-clipping distortion",
    signatures: [
      {
        label: "hard(distortion, volume)",
        parameters: [
          {
            label: "number distortion",
            documentation: "amount of distortion to apply",
          },
          {
            label: "number volume",
            documentation: "linear postgain of the distortion",
          },
        ],
      },
    ],
  },
  {
    name: "cubic",
    detail: "cubic/distortion,superdough",
    documentation: "Cubic polynomial distortion",
    signatures: [
      {
        label: "cubic(distortion, volume)",
        parameters: [
          {
            label: "number distortion",
            documentation: "amount of distortion to apply",
          },
          {
            label: "number volume",
            documentation: "linear postgain of the distortion",
          },
        ],
      },
    ],
  },
  {
    name: "diode",
    detail: "diode/distortion,superdough",
    documentation: "Diode-emulating distortion",
    signatures: [
      {
        label: "diode(distortion, volume)",
        parameters: [
          {
            label: "number distortion",
            documentation: "amount of distortion to apply",
          },
          {
            label: "number volume",
            documentation: "linear postgain of the distortion",
          },
        ],
      },
    ],
  },
  {
    name: "asym",
    detail: "asym/distortion,superdough",
    documentation: "Asymmetrical diode distortion",
    signatures: [
      {
        label: "asym(distortion, volume)",
        parameters: [
          {
            label: "number distortion",
            documentation: "amount of distortion to apply",
          },
          {
            label: "number volume",
            documentation: "linear postgain of the distortion",
          },
        ],
      },
    ],
  },
  {
    name: "fold",
    detail: "fold/distortion,superdough",
    documentation: "Wavefolding distortion",
    signatures: [
      {
        label: "fold(distortion, volume)",
        parameters: [
          {
            label: "number distortion",
            documentation: "amount of distortion to apply",
          },
          {
            label: "number volume",
            documentation: "linear postgain of the distortion",
          },
        ],
      },
    ],
  },
  {
    name: "sinefold",
    detail: "sinefold/distortion,superdough",
    documentation: "Wavefolding distortion composed with sinusoid",
    signatures: [
      {
        label: "sinefold(distortion, volume)",
        parameters: [
          {
            label: "number distortion",
            documentation: "amount of distortion to apply",
          },
          {
            label: "number volume",
            documentation: "linear postgain of the distortion",
          },
        ],
      },
    ],
  },
  {
    name: "chebyshev",
    detail: "chebyshev/distortion,superdough",
    documentation: "Distortion via Chebyshev polynomials",
    signatures: [
      {
        label: "chebyshev(distortion, volume)",
        parameters: [
          {
            label: "number distortion",
            documentation: "amount of distortion to apply",
          },
          {
            label: "number volume",
            documentation: "linear postgain of the distortion",
          },
        ],
      },
    ],
  },
  {
    name: "parray",
    detail: "parray/combiners",
    documentation:
      "Turns a list of patterns into a single pattern which outputs list-values",
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
      "Scale the magnitude of the harmonics of one of the core synths ('sine', 'tri',\n'saw', ..)\n\nCan also be used to create a new synth via s('user').partials(...)",
    signatures: [
      {
        label: "partials(magnitudes)",
        parameters: [
          {
            label: "Array.<number> magnitudes",
            documentation:
              "List of [0, 1] magnitudes for partials. 0th entry is the fundamental harmonic\n(i.e. DC offset is skipped)",
          },
        ],
      },
    ],
  },
  {
    name: "phases",
    detail: "phases/superdough",
    documentation:
      "Rotates the harmonics of one of the core synths ('sine', 'tri', 'saw', 'user',\n..) by a list of phases",
    signatures: [
      {
        label: "phases(phases)",
        parameters: [
          {
            label: "Array.<number> phases",
            documentation:
              "List of [0, 1) phases for partials. 0th entry is the fundamental phase (i.e. DC\noffset is skipped)",
          },
        ],
      },
    ],
  },
  {
    name: "FX",
    detail: "Pattern.FX/superdough",
    documentation:
      "Establishes an FX chain. Can be called by chaining .FX(fx1).FX(fx2).. calls\nand/or in a single .FX(fx1, fx2, ..) call. The fx1, .. are patterns which\nestablish the controls of the given effect. See examples.",
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
      'Produces a Kabelsalat [https://kabel.salat.dev/] modular sound engine. This can\nbe used as either an effect (by including audioin() at the beginning of your\nkabel expression) or as a sound source (via any expression which doesn\'t start\nwith audioin()).\n\nSome helpers you have available to you:\n\n * Strudel mini notation works fine in K(..) via "" or ``\n * More complex Strudel expressions (like "0 1 2".fast(4) or irand(24)) can be\n   written by wrapping them in S(..) inside your Kabel code\n * We expose Strudel\'s note frequency under sFreq and Strudel\'s gate information\n   under sGate\n * You can use more complex multi-line expressions (like let x = a; let y = b;\n   x.lpf(y);) by wrapping them inside a function in K (see example).',
    signatures: [
      {
        label: "K(expr)",
        parameters: [
          {
            label: "KabelsalatExpression expr",
            documentation: "Kabelsalat graph definition",
          },
        ],
      },
    ],
  },
  {
    name: "worklet",
    detail: "Pattern.worklet/noautocomplete",
    documentation:
      "Creates a worklet effect. Typically derived by writing K(...) in the REPL which\nwill parse Kabelsalat code.",
    signatures: [
      {
        label: "worklet(src, inputs)",
        parameters: [
          {
            label: "string src",
            documentation: "Source code of the worklet update function",
          },
          {
            label: "number inputs",
            documentation: "Worklet inputs",
          },
        ],
      },
    ],
  },
  {
    name: "base",
    detail: "base/generators",
    documentation:
      "Creates a pattern of numbers in base b from a number or pattern of numbers\nlimited to d digits long from the right",
    signatures: [
      {
        label: "base(n, b, d)",
        parameters: [
          {
            label: "number n",
            documentation: "number to convert (can be a pattern or array)",
          },
          {
            label: "number b",
            documentation:
              "base to convert to (defaults to 10) (can be a pattern)",
          },
          {
            label: "number d",
            documentation:
              "max number of digits to produce for each n (defaults to 0 for all) (can be a\npattern)",
          },
        ],
      },
    ],
  },
  {
    name: "pick",
    detail: "pick/combiners",
    documentation:
      "Picks patterns (or plain values) either from a list (by index) or a lookup table\n(by name). Similar to inhabit, but maintains the structure of the original\npatterns.",
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
      "The same as pick, but if you pick a number greater than the size of the list, it\nwraps around, rather than sticking at the maximum value. For example, if you\npick the fifth pattern of a list of three, you'll get the second one.",
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
      "pickF lets you use a pattern of numbers to pick which function to apply to\nanother pattern.",
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
            documentation: "a pattern of indices or names",
          },
          {
            label: "Array.<function()> lookup",
            documentation:
              "the array or lookup object of functions from which to pull",
          },
        ],
      },
    ],
  },
  {
    name: "pickmodF",
    detail: "pickmodF/combiners",
    documentation:
      "The same as pickF, but if you pick a number greater than the size of the\nfunctions list, it wraps around, rather than sticking at the maximum value.",
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
            documentation: "a pattern of indices or names",
          },
          {
            label: "Array.<function()> lookup",
            documentation:
              "the array or lookup object of functions from which to pull",
          },
        ],
      },
    ],
  },
  {
    name: "pickOut",
    detail: "pickOut/combiners",
    documentation:
      "Similar to pick, but it applies an outerJoin instead of an innerJoin.",
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
      "The same as pickOut, but if you pick a number greater than the size of the list,\nit wraps around, rather than sticking at the maximum value.",
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
      "Similar to pick, but the choosen pattern is restarted when its index is\ntriggered.",
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
      "The same as pickRestart, but if you pick a number greater than the size of the\nlist, it wraps around, rather than sticking at the maximum value.",
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
      "Similar to pick, but the choosen pattern is reset when its index is triggered.",
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
      "The same as pickReset, but if you pick a number greater than the size of the\nlist, it wraps around, rather than sticking at the maximum value.",
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
      "Picks patterns (or plain values) either from a list (by index) or a lookup table\n(by name). Similar to pick, but cycles are squeezed into the target\n('inhabited') pattern.",
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
      "The same as inhabit, but if you pick a number greater than the size of the list,\nit wraps around, rather than sticking at the maximum value. For example, if you\npick the fifth pattern of a list of three, you'll get the second one.",
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
      "Pick from the list of values (or patterns of values) via the index using the\ngiven pattern of integers. The selected pattern will be compressed to fit the\nduration of the selecting event",
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
    documentation: "Changes the global tempo to the given cycles per minute",
    signatures: [
      {
        label: "setcpm(cpm)",
        parameters: [
          {
            label: "number cpm",
            documentation: "cycles per minute",
          },
        ],
      },
    ],
  },
  {
    name: "all",
    detail: "repl~all/combiners",
    documentation:
      'Applies a function to all the running patterns. Note that the patterns are\ngrouped together into a single stack before the function is applied. This is\nprobably what you want, but see each for a version that applies the function to\neach pattern separately.\n\nNote: Patterns must be labeled (e.g. with $:) to be picked up by all. An\nunlabeled pattern such as note("c4") is not registered and will produce no audio\nwhen all is present. Use $: note("c4") instead.\n\n$: sound("bd - cp sd")\n$: sound("hh*8")\nall(fast("<2 3>"))\n\n\n$: sound("bd - cp sd")\n$: sound("hh*8")\nall(x => x.pianoroll())\n',
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
      'Applies a function to each of the running patterns separately. This is intended\nfor future use with upcoming \'stepwise\' features. See all for a version that\napplies the function to all the patterns stacked together into a single pattern.\n\nNote: Patterns must be labeled (e.g. with $:) to be picked up by each. An\nunlabeled pattern such as note("c4") is not registered and will produce no audio\nwhen each is present. Use $: note("c4") instead.\n\n$: sound("bd - cp sd")\n$: sound("hh*8")\neach(fast("<2 3>"))\n',
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
    documentation: "Creates a signal given by the input function",
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
    documentation: "A sawtooth signal between 0 and 1.",
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
      "A sawtooth signal between -1 and 1 (like saw, but bipolar).",
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
    documentation: "A sawtooth signal between 1 and 0 (like saw, but flipped).",
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
      "A sawtooth signal between 1 and -1 (like saw2, but flipped).",
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
    documentation: "A sine signal between -1 and 1 (like sine, but bipolar).",
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
    documentation: "A sine signal between 0 and 1.",
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
    documentation: "A cosine signal between 0 and 1.",
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
      "A cosine signal between -1 and 1 (like cosine, but bipolar).",
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
    documentation: "A square signal between 0 and 1.",
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
      "A square signal between -1 and 1 (like square, but bipolar).",
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
    documentation: "A square signal between 1 and 0 (like square but flipped).",
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
      "A square signal between 1 and -1 (like isquare, but bipolar).",
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
    documentation: "A triangle signal between 0 and 1.",
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
      "A triangle signal between -1 and 1 (like tri, but bipolar).",
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
      "An inverted triangle signal between 1 and 0 (like tri, but flipped).",
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
      "An inverted triangle signal between -1 and 1 (like itri, but bipolar).",
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
    documentation: "A signal representing the cycle time.",
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
    documentation: "The mouse's x position value ranges from 0 to 1.",
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
    documentation: "The mouse's y position value ranges from 0 to 1.",
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
      "Sets which random number generator to use. Historically Strudel would use\nuseRNG('legacy'), which remains the default. To use a new more statistically\nprecise RNG, try useRNG('precise').",
    signatures: [
      {
        label: "useRNG(mod)",
        parameters: [
          {
            label: "string mod",
            documentation: "Mode. One of 'legacy', 'precise'",
          },
        ],
      },
    ],
  },
  {
    name: "run",
    detail: "run/generators",
    documentation: "A discrete pattern of numbers from 0 to n-1",
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
    documentation: "Creates a binary pattern from a number.",
    signatures: [
      {
        label: "binary(n)",
        parameters: [
          {
            label: "number n",
            documentation: "input number to convert to binary",
          },
        ],
      },
    ],
  },
  {
    name: "binaryN",
    detail: "binaryN/generators",
    documentation:
      "Creates a binary pattern from a number, padded to n bits long.",
    signatures: [
      {
        label: "binaryN(n, nBits)",
        parameters: [
          {
            label: "number n",
            documentation: "input number to convert to binary",
          },
          {
            label: "number nBits",
            documentation: "pattern length, defaults to 16",
          },
        ],
      },
    ],
  },
  {
    name: "binaryL",
    detail: "binaryL/generators",
    documentation: "Creates a binary list pattern from a number.",
    signatures: [
      {
        label: "binaryL(n)",
        parameters: [
          {
            label: "number n",
            documentation:
              'input number to convert to binary s("saw").seg(8)\n.partials(binaryL(irand(4096).add(1)))',
          },
        ],
      },
    ],
  },
  {
    name: "binaryNL",
    detail: "binaryNL/generators",
    documentation:
      "Creates a binary list pattern from a number, padded to n bits long.",
    signatures: [
      {
        label: "binaryNL(n, nBits)",
        parameters: [
          {
            label: "number n",
            documentation: "input number to convert to binary",
          },
          {
            label: "number nBits",
            documentation: "pattern length, defaults to 16",
          },
        ],
      },
    ],
  },
  {
    name: "randL",
    detail: "randL/generators",
    documentation: "Creates a list of random numbers of the given length",
    signatures: [
      {
        label: "randL(n)",
        parameters: [
          {
            label: "number n",
            documentation: "Number of random numbers to sample",
          },
        ],
      },
    ],
  },
  {
    name: "shuffle",
    detail: "shuffle/temporal",
    documentation:
      "Slices a pattern into the given number of parts, then plays those parts in\nrandom order. Each part will be played exactly once per cycle.",
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
      "Slices a pattern into the given number of parts, then plays those parts at\nrandom. Similar to shuffle, but parts might be played more than once, or not at\nall, per cycle.",
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
      "Modify a pattern by applying a function to the randomSeed control if present",
    signatures: [
      {
        label: "withSeed(func, pat)",
        parameters: [
          {
            label: "function func",
            documentation:
              "Function from seed (or undefined) to seed (or undefined)",
          },
          {
            label: "Pattern pat",
            documentation: "Pattern to update",
          },
        ],
      },
    ],
  },
  {
    name: "seed",
    detail: "seed/math",
    documentation:
      "Change the seed for random signals. Normally, random signals depend on time, so\ntwo patterns at the same time will have the same random values. Specifying a new\nseed changes the signal output by rand. This also affects other functions that\nuse randomness, like shuffle and sometimes.",
    signatures: [
      {
        label: "seed(n)",
        parameters: [
          {
            label: "number n",
            documentation: "A new seed. Can be any number.",
          },
        ],
      },
    ],
  },
  {
    name: "rand",
    detail: "rand/generators",
    documentation: "A continuous pattern of random numbers, between 0 and 1.",
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
    documentation: "A continuous pattern of random numbers, between -1 and 1",
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
      "A continuous pattern of 0 or 1 (binary random), with a probability for the value\nbeing 1",
    signatures: [
      {
        label: "brandBy(probability)",
        parameters: [
          {
            label: "number probability",
            documentation: "a number between 0 and 1",
          },
        ],
      },
    ],
  },
  {
    name: "brand",
    detail: "brand/generators",
    documentation: "A continuous pattern of 0 or 1 (binary random)",
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
      "A continuous pattern of random integers, between 0 and n-1.",
    signatures: [
      {
        label: "irand(n)",
        parameters: [
          {
            label: "number n",
            documentation: "max value (exclusive)",
          },
        ],
      },
    ],
  },
  {
    name: "chooseWith",
    detail: "chooseWith/temporal",
    documentation:
      "Choose from the list of values (or patterns of values) using the given pattern\nof numbers, which should be in the range of 0..1",
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
      "As with {chooseWith}, but the structure comes from the chosen values, rather\nthan the pattern you're using to choose with.",
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
    documentation: "Chooses randomly from the given list of elements.",
    signatures: [
      {
        label: "choose(xs)",
        parameters: [
          {
            label: "any xs",
            documentation: "values / patterns to choose from.",
          },
        ],
      },
    ],
  },
  {
    name: "choose",
    detail: "Pattern#choose/temporal",
    documentation:
      "Chooses from the given list of values (or patterns of values), according to the\npattern that the method is called on. The pattern should be in the range 0 .. 1.",
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
      "As with choose, but the pattern that this method is called on should be in the\nrange -1 .. 1",
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
    documentation: "Picks one of the elements at random each cycle.",
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
      "Chooses randomly from the given list of elements by giving a probability to each\nelement",
    signatures: [
      {
        label: "wchoose(pairs)",
        parameters: [
          {
            label: "any pairs",
            documentation: "arrays of value and weight",
          },
        ],
      },
    ],
  },
  {
    name: "wchooseCycles",
    detail: "wchooseCycles/temporal",
    documentation:
      "Picks one of the elements at random each cycle by giving a probability to each\nelement",
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
      "Generates a continuous pattern of perlin noise\n[https://en.wikipedia.org/wiki/Perlin_noise], in the range 0..1.",
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
      "Generates a continuous pattern of [berlin noise](conceived by Jame Coyne and\nJade Rowland as a joke but turned out to be surprisingly cool and useful, like\nperlin noise but with sawtooth waves), in the range 0..1.",
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
      "degradeByWith is like degradeBy, but with control over the random or other\nsignal used to filter out the events.\n\ndegradeBy(x) is essentially degradeByWith(rand, x)\n\nThis allows you to do things other than with rand, see examples below",
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
      "Randomly removes events from the pattern by a given amount. 0 = 0% chance of\nremoval 1 = 100% chance of removal",
    signatures: [
      {
        label: "degradeBy(amount)",
        parameters: [
          {
            label: "number amount",
            documentation: "a number between 0 and 1",
          },
        ],
      },
    ],
  },
  {
    name: "degrade",
    detail: "Pattern.degrade/temporal",
    documentation:
      "Randomly removes 50% of events from the pattern. Shorthand for .degradeBy(0.5)",
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
      "Inverse of degradeBy: Randomly removes events from the pattern by a given\namount. 0 = 100% chance of removal 1 = 0% chance of removal Events that would be\nremoved by degradeBy are let through by undegradeBy and vice versa (see second\nexample).",
    signatures: [
      {
        label: "undegradeBy(amount)",
        parameters: [
          {
            label: "number amount",
            documentation: "a number between 0 and 1",
          },
        ],
      },
    ],
  },
  {
    name: "undegrade",
    detail: "Pattern.undegrade/temporal",
    documentation:
      "Inverse of degrade: Randomly removes 50% of events from the pattern. Shorthand\nfor .undegradeBy(0.5) Events that would be removed by degrade are let through by\nundegrade and vice versa (see second example).",
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
      "Randomly applies the given function by the given probability. Similar to\nsomeCyclesBy",
    signatures: [
      {
        label: "sometimesBy(probability, function)",
        parameters: [
          {
            label: "number probability",
            documentation: "a number between 0 and 1",
          },
          {
            label: "function function",
            documentation: "the transformation to apply",
          },
        ],
      },
    ],
  },
  {
    name: "sometimes",
    detail: "Pattern.sometimes/temporal",
    documentation: "Applies the given function with a 50% chance",
    signatures: [
      {
        label: "sometimes(function)",
        parameters: [
          {
            label: "function function",
            documentation: "the transformation to apply",
          },
        ],
      },
    ],
  },
  {
    name: "someCyclesBy",
    detail: "Pattern.someCyclesBy/temporal",
    documentation:
      "Randomly applies the given function by the given probability on a cycle by cycle\nbasis. Similar to sometimesBy",
    signatures: [
      {
        label: "someCyclesBy(probability, function)",
        parameters: [
          {
            label: "number probability",
            documentation: "a number between 0 and 1",
          },
          {
            label: "function function",
            documentation: "the transformation to apply",
          },
        ],
      },
    ],
  },
  {
    name: "someCycles",
    detail: "Pattern.someCycles/temporal",
    documentation: "Shorthand for .someCyclesBy(0.5, fn)",
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
    documentation: "Shorthand for .sometimesBy(0.75, fn)",
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
    documentation: "Shorthand for .sometimesBy(0.25, fn)",
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
    documentation: "Shorthand for .sometimesBy(0.1, fn)",
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
    documentation: "Shorthand for .sometimesBy(0.9, fn)",
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
    documentation: "Shorthand for .sometimesBy(0, fn) (never calls fn)",
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
    documentation: "Shorthand for .sometimesBy(1, fn) (always calls fn)",
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
      "Do something on a keypress, or array of keypresses Key name reference\n[https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_key_values]",
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
      "returns true when a key or array of keys is held Key name reference\n[https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_key_values]",
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
      'A pattern measuring the duration of events, in cycles per event. cyclesPer\ndoesn\'t have structure itself, but takes structure, and therefore event\ndurations, from the pattern that it is combined with. For example\ncyclesPer.struct("1 1 [1 1] 1") would give the same as "0.25 0.25 [0.125 0.125]\n0.25". See also its reciprocal, per, also known as perCycle.',
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
      'A pattern measuring the \'shortness\' of events, or in other words, the duration\nof pattern events, in events per cycle. per doesn\'t have structure itself, but\ntakes structure, and therefore event durations, from the pattern that it is\ncombined with. For example per.struct("1 1 [1 1] 1") would give the same as "4 4\n[8 8] 4". See also its reciprocal, cyclesPer.',
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
      'Like per but measures the shortness of events according to an exponential curve.\nIn particular, where the event duration halves, the returned value increases by\none. perx.struct("1 1 [1 [1 1]] 1") would therefore be the same as "3 3 [4 [5\n5]] 3".',
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
      "A signal that goes from 0 to 1 over one cycle, and then stays at 1 forever.\nMainly useful in combination with other functions that reset the cycle. See also\nclose.",
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
      "The same as open, but goes from 1 to 0 over one cycle, and then stays on 0\nforever.",
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
      "Given a hap, returns the frequency of the note or freq, if defined\n\nGiven a note, returns the frequency of that note getFreq('c3')\n\nGiven a midi note number, returns the frequency of that midi note getFreq('c3')",
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
      "Sends notes to Csound for rendering with MIDI semantics. The hap value is\ntranslated to these Csound pfields:\n\np1 -- Csound instrument either as a number (1-based, can be a fraction), or as a\nstring name. p2 -- time in beats (usually seconds) from start of performance. p3\n-- duration in beats (usually seconds). p4 -- MIDI key number (as a real number,\nnot an integer but in [0, 127]. p5 -- MIDI velocity (as a real number, not an\ninteger but in [0, 127]. p6 -- Strudel controls, as a string.",
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
      "initializes dough ahead of time. you don't need to use this, but if you do, you\ncan await it, so dough is ready before the pattern starts.",
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
      "Uses dough as the audio engine. more info at https://dough.strudel.cc",
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
      "Visualises a pattern as a scrolling 'pianoroll', displayed in the background of\nthe editor. To show a pianoroll for all running patterns, use all(pianoroll). To\nhave a pianoroll appear below a pattern instead, prefix with _, e.g.: sound(\"bd\nsd\")._pianoroll().",
    signatures: [
      {
        label:
          "pianoroll(options, cycles, playhead, vertical, labels, flipTime, flipValues, overscan, hideNegative, smear, fold, active, inactive, background, playheadColor, fill, fillActive, stroke, strokeActive, hideInactive, colorizeInactive, fontFamily, minMidi, maxMidi, autorange)",
        parameters: [
          {
            label: "Object options",
            documentation:
              "Object containing all the optional following parameters as key value pairs:",
          },
          {
            label: "integer cycles",
            documentation:
              "number of cycles to be displayed at the same time - defaults to 4",
          },
          {
            label: "number playhead",
            documentation:
              "location of the active notes on the time axis - 0 to 1, defaults to 0.5",
          },
          {
            label: "boolean vertical",
            documentation: "displays the roll vertically - 0 by default",
          },
          {
            label: "boolean labels",
            documentation:
              "displays labels on individual notes (see the label function) - 0 by default",
          },
          {
            label: "boolean flipTime",
            documentation: "reverse the direction of the roll - 0 by default",
          },
          {
            label: "boolean flipValues",
            documentation:
              "reverse the relative location of notes on the value axis - 0 by default",
          },
          {
            label: "number overscan",
            documentation:
              "lookup X cycles outside of the cycles window to display notes in advance - 1 by\ndefault",
          },
          {
            label: "boolean hideNegative",
            documentation:
              "hide notes with negative time (before starting playing the pattern) - 0 by\ndefault",
          },
          {
            label: "boolean smear",
            documentation: "notes leave a solid trace - 0 by default",
          },
          {
            label: "boolean fold",
            documentation:
              "notes takes the full value axis width - 0 by default",
          },
          {
            label: "string active",
            documentation:
              "hexadecimal or CSS color of the active notes - defaults to #FFCA28",
          },
          {
            label: "string inactive",
            documentation:
              "hexadecimal or CSS color of the inactive notes - defaults to #7491D2",
          },
          {
            label: "string background",
            documentation:
              "hexadecimal or CSS color of the background - defaults to transparent",
          },
          {
            label: "string playheadColor",
            documentation:
              "hexadecimal or CSS color of the line representing the play head - defaults to\nwhite",
          },
          {
            label: "boolean fill",
            documentation:
              "notes are filled with color (otherwise only the label is displayed) - 0 by\ndefault",
          },
          {
            label: "boolean fillActive",
            documentation: "active notes are filled with color - 0 by default",
          },
          {
            label: "boolean stroke",
            documentation:
              "notes are shown with colored borders - 0 by default",
          },
          {
            label: "boolean strokeActive",
            documentation:
              "active notes are shown with colored borders - 0 by default",
          },
          {
            label: "boolean hideInactive",
            documentation: "only active notes are shown - 0 by default",
          },
          {
            label: "boolean colorizeInactive",
            documentation: "use note color for inactive notes - 1 by default",
          },
          {
            label: "string fontFamily",
            documentation:
              "define the font used by notes labels - defaults to 'monospace'",
          },
          {
            label: "integer minMidi",
            documentation:
              "minimum note value to display on the value axis - defaults to 10",
          },
          {
            label: "integer maxMidi",
            documentation:
              "maximum note value to display on the value axis - defaults to 90",
          },
          {
            label: "boolean autorange",
            documentation:
              "automatically calculate the minMidi and maxMidi parameters - 0 by default",
          },
        ],
      },
    ],
  },
  {
    name: "wordfall",
    detail: "wordfall/visualization",
    documentation:
      "Displays a vertical pianoroll with event labels. Supports all the same options\nas pianoroll.",
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
      "Renders a pitch circle to visualize frequencies within one octave",
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
    documentation: "Displays a spiral visual.",
    signatures: [
      {
        label:
          "spiral(options, stretch, size, thickness, cap, inset, playheadColor, playheadLength, playheadThickness, padding, steady, activeColor, inactiveColor, colorizeInactive, fade, logSpiral)",
        parameters: [
          {
            label: "Object options",
            documentation:
              "Object containing all the optional following parameters as key value pairs:",
          },
          {
            label: "number stretch",
            documentation:
              "controls the rotations per cycle ratio, where 1 = 1 cycle / 360 degrees",
          },
          {
            label: "number size",
            documentation: "the diameter of the spiral",
          },
          {
            label: "number thickness",
            documentation: "line thickness",
          },
          {
            label: "string cap",
            documentation: "style of line ends: butt (default), round, square",
          },
          {
            label: "string inset",
            documentation:
              "number of rotations before spiral starts (default 3)",
          },
          {
            label: "string playheadColor",
            documentation: "color of playhead, defaults to white",
          },
          {
            label: "number playheadLength",
            documentation: "length of playhead in rotations, defaults to 0.02",
          },
          {
            label: "number playheadThickness",
            documentation:
              "thickness of playheadrotations, defaults to thickness",
          },
          {
            label: "number padding",
            documentation: "space around spiral",
          },
          {
            label: "number steady",
            documentation:
              "steadyness of spiral vs playhead. 1 = spiral doesn't move, playhead does.",
          },
          {
            label: "number activeColor",
            documentation:
              "color of active segment. defaults to foreground of theme",
          },
          {
            label: "number inactiveColor",
            documentation:
              "color of inactive segments. defaults to gutterForeground of theme",
          },
          {
            label: "boolean colorizeInactive",
            documentation:
              "wether or not to colorize inactive segments, defaults to 0",
          },
          {
            label: "boolean fade",
            documentation:
              "wether or not past and future should fade out. defaults to 1",
          },
          {
            label: "boolean logSpiral",
            documentation:
              "wether or not the spiral should be logarithmic. defaults to 0",
          },
        ],
      },
    ],
  },
  {
    name: "edoScale",
    detail: "edoScale",
    documentation:
      "Turns numbers into notes in the given EDO scale (zero indexed).\n\nAn EDO scale definition looks like this:\n\ne.g. C:LLsLLLs:2:1 <- this is the C major scale, 12 EDO\n\ne.g. C:LLsLLL:3:1 <- this is the Gorgo 6 note scale, 16 EDO\n\nAn EDO scale, e.g. C:LLsLLLs:2:1, consists of a root note (e.g. C) followed by\nsemicolon (':') and then a Large/small step notation sequence\n[https://en.xen.wiki/w/MOS_scale] (e.g. LLsLLLs) followed by semicolon, then the\nlarge step size (e.g. 2) followed by semicolon, then the small step size (e.g.\n1).\n\nThe number of divisions of the octave is calculated as the sum of the steps in\nthe EDO scale definition.\n\ne.g. C:LLsLLLs:2:1 is 2+2+1+2+2+2+1 = 12 EDO, 7 note scale\n\ne.g. C:LLsLLL:3:1 is 3+3+1+3+3+3 = 16 EDO, 6 note scale\n\nThe root note defaults to octave 3, if no octave number is given.",
    signatures: [
      {
        label: "edoScale(scale)",
        parameters: [
          {
            label: "string scale",
            documentation: "Definition of EDO scale.",
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
            documentation: "MIDI device name or index defaulting to 0",
          },
        ],
      },
    ],
  },
  {
    name: "createCC",
    detail: "MidiInput#createCC",
    documentation:
      "Implementation for the cc() factory function tied to this specific input.",
    signatures: [
      {
        label: "createCC(cc, chan)",
        parameters: [
          {
            label: "number cc",
            documentation: "MIDI CC number",
          },
          {
            label: "number chan",
            documentation: "MIDI channel (1-16) or undefined for all channels",
          },
        ],
      },
    ],
  },
  {
    name: "defaultmidimap",
    detail: "defaultmidimap/external_io,midi",
    documentation:
      'configures the default midimap, which is used when no "midimap" port is set',
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
      "Adds midimaps to the registry. Inside each midimap, control names (e.g. lpf) are\nmapped to cc numbers.",
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
    documentation: "MIDI output: Opens a MIDI output port.",
    signatures: [
      {
        label: "midi(midiport, options)",
        parameters: [
          {
            label: "string midiport",
            documentation: "MIDI device name or index defaulting to 0",
          },
          {
            label: "object options",
            documentation: "Additional MIDI configuration options",
          },
        ],
      },
    ],
  },
  {
    name: "_initializeInput",
    detail: "_initializeInput",
    documentation: "Initialize a midi input device",
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
      "MIDI input: Opens a MIDI input port to receive MIDI control change messages.\n\nThe output is a function that accepts a midi cc value to query as well as\n(optionally) a midi channel",
    signatures: [
      {
        label: "midin(input)",
        parameters: [
          {
            label: "string input",
            documentation: "MIDI device name or index defaulting to 0",
          },
        ],
      },
    ],
  },
  {
    name: "midikeys",
    detail: "midikeys/external_io,midi",
    documentation:
      "MIDI keyboard: Opens a MIDI input port to receive MIDI keyboard messages.\n\nThe note length is fixed as Superdough is not currently set up for undetermined\nnote durations\n\nThe 'midichan' control value contains the number of the channel the note is\ncoming from so it could be filtered or manipulated further in the chain.",
    signatures: [
      {
        label: "midikeys(input)",
        parameters: [
          {
            label: "string input",
            documentation: "MIDI device name or index defaulting to 0",
          },
        ],
      },
    ],
  },
  {
    name: "getMidiDeviceNamesString",
    detail: "getMidiDeviceNamesString",
    documentation: "Get a string listing device names for error messages.",
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
      "Look up a device by index or name. Otherwise return a default device, or fail if\nnone are connected.",
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
    documentation: "The accelerometer's x-axis value ranges from 0 to 1.",
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
    documentation: "The accelerometer's y-axis value ranges from 0 to 1.",
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
    documentation: "The accelerometer's z-axis value ranges from 0 to 1.",
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
    documentation: "The device's gravity x-axis value ranges from 0 to 1.",
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
    documentation: "The device's gravity y-axis value ranges from 0 to 1.",
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
    documentation: "The device's gravity z-axis value ranges from 0 to 1.",
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
      "The device's rotation around the alpha-axis value ranges from 0 to 1.",
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
      "The device's rotation around the beta-axis value ranges from 0 to 1.",
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
      "The device's rotation around the gamma-axis value ranges from 0 to 1.",
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
    documentation: "The device's orientation alpha value ranges from 0 to 1.",
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
    documentation: "The device's orientation beta value ranges from 0 to 1.",
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
    documentation: "The device's orientation gamma value ranges from 0 to 1.",
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
      "The device's absolute orientation alpha value ranges from 0 to 1.",
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
      "The device's absolute orientation beta value ranges from 0 to 1.",
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
      "The device's absolute orientation gamma value ranges from 0 to 1.",
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
      "Sends each hap as an OSC message, which can be picked up by SuperCollider or any\nother OSC-enabled software. For more info, read MIDI & OSC in the docs\n[https://strudel.cc/learn/input-output/]",
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
      "Handles dynamic reallocation of input/output channels buffer (channel numbers\nmay vary during lifecycle)",
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
    documentation: "Read next web audio block to input buffers",
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
    documentation: "Write next web audio block from output buffers",
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
      "Shift left content of input buffers to receive new web audio block",
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
      "Shift left content of output buffers to receive new web audio block",
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
      "Copy contents of input buffers to buffer actually sent to process",
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
      "Add contents of output buffers just processed to output buffers",
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
    documentation: "Generates a reverb impulse response.",
    signatures: [
      {
        label: "generateReverb(params, callback)",
        parameters: [
          {
            label: "Object params",
            documentation: "TODO: Document the properties.",
          },
          {
            label: "function callback",
            documentation:
              "Function to call when the impulse response has been generated. The impulse\nresponse is passed to this function as its parameter. May be called immediately\nwithin the current execution context, or later.",
          },
        ],
      },
    ],
  },
  {
    name: "generateGraph",
    detail: "reverbGen.generateGraph/internals",
    documentation:
      "Creates a canvas element showing a graph of the given data.",
    signatures: [
      {
        label: "generateGraph(data, width, height, min, max)",
        parameters: [
          {
            label: "Float32Array data",
            documentation: "An array of numbers, or a Float32Array.",
          },
          {
            label: "number width",
            documentation: "Width in pixels of the canvas.",
          },
          {
            label: "number height",
            documentation: "Height in pixels of the canvas.",
          },
          {
            label: "number min",
            documentation: "Minimum value of data for the graph (lower edge).",
          },
          {
            label: "number max",
            documentation: "Maximum value of data in the graph (upper edge).",
          },
        ],
      },
    ],
  },
  {
    name: "applyGradualLowpass",
    detail: "applyGradualLowpass/internals",
    documentation:
      "Applies a constantly changing lowpass filter to the given sound.",
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
              "May be called immediately within the current execution context, or later.",
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
      'Returns the duration, in seconds, of the given sample. Has optional param n (for\ninstance, the 2 in s("casio:2"))\n\nNote: must be called with await, otherwise you\'ll get a pending Promise object.',
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
            documentation: "n",
          },
        ],
      },
    ],
  },
  {
    name: "samples",
    detail: "samples/samples",
    documentation: "Loads a collection of samples to use with s",
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
      "Set the max polyphony. If notes are ringing out via release then they will start\nto die out in first-in-first-out order once the max polyphony has been hit",
    signatures: [
      {
        label: "setMaxPolyphony(Max)",
        parameters: [
          {
            label: "number Max",
            documentation: "polyphony. Defaults to 128",
          },
        ],
      },
    ],
  },
  {
    name: "setGainCurve",
    detail: "setGainCurve/amplitude,superdough",
    documentation:
      "Apply a function to all gains provided in patterns. Can be used to rescale gain\nto be quadratic, exponential, etc. rather than linear",
    signatures: [
      {
        label: "setGainCurve(function)",
        parameters: [
          {
            label: "function function",
            documentation: "to apply to all gain values",
          },
        ],
      },
    ],
  },
  {
    name: "aliasBank",
    detail: "aliasBank/samples",
    documentation:
      "Register an alias for a bank of sounds. Optionally accepts a single argument map\nof bank aliases. Optionally accepts a single argument string of a path to a JSON\nfile containing bank aliases.",
    signatures: [
      {
        label: "aliasBank(bank, alias)",
        parameters: [
          {
            label: "string bank",
            documentation: "The bank to alias",
          },
          {
            label: "string alias",
            documentation: "The alias to use for the bank",
          },
        ],
      },
    ],
  },
  {
    name: "soundAlias",
    detail: "soundAlias/samples",
    documentation: "Register an alias for a sound.",
    signatures: [
      {
        label: "soundAlias(original, alias)",
        parameters: [
          {
            label: "string original",
            documentation: "The original sound name",
          },
          {
            label: "string alias",
            documentation: "The alias to use for the sound",
          },
        ],
      },
    ],
  },
  {
    name: "pickAndRename",
    detail: "pickAndRename/internals",
    documentation: "Selects entries from source and renames them via map",
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
    documentation: "Loads a collection of wavetables to use with s",
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
    documentation: "Apply Hann window in-place",
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
    documentation: "Compute squared magnitudes for peak finding",
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
    documentation: "Find peaks in spectrum magnitudes",
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
      "Shift peaks and regions of influence by pitchFactor into new specturm",
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
    documentation: "BYTE BEATS",
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
      "Change the pitch of each value by the given amount. Expects numbers or note\nstrings as values. The amount can be given as a number of semitones or as a\nstring in interval short notation. If you don't care about enharmonic\ncorrectness, just use numbers. Otherwise, pass the interval of the form: ST\nwhere S is the degree number and T the type of interval with\n\n * M = major\n * m = minor\n * P = perfect\n * A = augmented\n * d = diminished\n\nExamples intervals:\n\n * 1P = unison\n * 3M = major third\n * 3m = minor third\n * 4P = perfect fourth\n * 4A = augmented fourth\n * 5P = perfect fifth\n * 5d = diminished fifth",
    signatures: [
      {
        label: "transpose(amount)",
        parameters: [
          {
            label: "string amount",
            documentation: "Either number of semitones or interval string.",
          },
        ],
      },
    ],
  },
  {
    name: "scaleTranspose",
    detail: "Pattern.scaleTranspose/tonal",
    documentation:
      "Transposes notes inside the scale by the number of steps. Expected to be called\non a Pattern which already has a {@link Pattern#scale}",
    signatures: [
      {
        label: "scaleTranspose(offset)",
        parameters: [
          {
            label: "offset offset",
            documentation: "number of steps inside the scale",
          },
        ],
      },
    ],
  },
  {
    name: "scale",
    detail: "scale/tonal",
    documentation:
      "Turns numbers into notes in the scale (zero indexed) or quantizes notes to a\nscale.\n\nWhen describing notes via numbers, note that negative numbers can be used to\nwrap backwards in the scale as well as sharps or flats to produce notes outside\nof the scale.\n\nAlso sets scale for other scale operations, like {@link Pattern#scaleTranspose}.\n\nA scale consists of a root note (e.g. c4, c, f#, bb4) followed by semicolon\n(':') and then a scale type\n[https://github.com/tonaljs/tonal/blob/main/packages/scale-type/data.ts].\n\nThe scale name must be written without spaces (because it would be interpreted\nas a multi-step pattern otherwise). If your scale name includes spaces, replace\nthem with colons.\n\nThe root note defaults to octave 3, if no octave number is given.",
    signatures: [
      {
        label: "scale(scale)",
        parameters: [
          {
            label: "string scale",
            documentation: "Name of scale",
          },
        ],
      },
    ],
  },
  {
    name: "addVoicings",
    detail: "Pattern.addVoicings/tonal",
    documentation: "Adds a new custom voicing dictionary.",
    signatures: [
      {
        label: "addVoicings(name, dictionary, range)",
        parameters: [
          {
            label: "string name",
            documentation: "identifier for the voicing dictionary",
          },
          {
            label: "Object dictionary",
            documentation: "maps chord symbol to possible voicings",
          },
          {
            label: "Array range",
            documentation: "min, max note",
          },
        ],
      },
    ],
  },
  {
    name: "voicings",
    detail: "Pattern.voicings/tonal",
    documentation:
      "DEPRECATED: still works, but it is recommended you use .voicing instead (without\ns). Turns chord symbols into voicings, using the smoothest voice leading\npossible. Uses chord-voicings package\n[https://github.com/felixroos/chord-voicings#chord-voicings].",
    signatures: [
      {
        label: "voicings(dictionary)",
        parameters: [
          {
            label: "string dictionary",
            documentation: "which voicing dictionary to use.",
          },
        ],
      },
    ],
  },
  {
    name: "rootNotes",
    detail: "Pattern.rootNotes/tonal",
    documentation:
      "Maps the chords of the incoming pattern to root notes in the given octave.",
    signatures: [
      {
        label: "rootNotes(octave)",
        parameters: [
          {
            label: "octave octave",
            documentation: "octave to use",
          },
        ],
      },
    ],
  },
  {
    name: "voicing",
    detail: "voicing/tonal",
    documentation:
      "Turns chord symbols into voicings. You can use the following control params:\n\n * chord: Note, followed by chord symbol, e.g. C Am G7 Bb^7\n * dict: voicing dictionary to use, falls back to default dictionary\n * anchor: the note that is used to align the chord\n * mode: how the voicing is aligned to the anchor\n   * below: top note <= anchor\n   * duck: top note <= anchor, anchor excluded\n   * above: bottom note >= anchor\n   * root: bottom note is the lowest root of the chord >= anchor\n   * oldabove : old (buggy) behavior of above, kept for legacy reason\n   * oldroot : old (buggy) behavior of root, kept for legacy reason\n * offset: whole number that shifts the voicing up or down to the next voicing\n * n: if set, the voicing is played like a scale. Overshooting numbers will be\n   octaved\n\nAll of the above controls are optional, except chord. If you pass a pattern of\nstrings to voicing, they will be interpreted as chords.",
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
      "Renders an oscilloscope for the frequency domain of the audio signal.",
    signatures: [
      {
        label: "fscope(color, scale, pos, lean, min, max)",
        parameters: [
          {
            label: "string color",
            documentation:
              "line color as hex or color name. defaults to white.",
          },
          {
            label: "number scale",
            documentation: "scales the y-axis. Defaults to 0.25",
          },
          {
            label: "number pos",
            documentation:
              "y-position relative to screen height. 0 = top, 1 = bottom of screen",
          },
          {
            label: "number lean",
            documentation: "y-axis alignment where 0 = top and 1 = bottom",
          },
          {
            label: "number min",
            documentation: "min value",
          },
          {
            label: "number max",
            documentation: "max value",
          },
        ],
      },
    ],
  },
  {
    name: "scope",
    detail: "scope/visualization",
    documentation:
      "Renders an oscilloscope for the time domain of the audio signal.",
    signatures: [
      {
        label: "scope(config, align, color, thickness, scale, pos, trigger)",
        parameters: [
          {
            label: "object config",
            documentation: "optional config with options:",
          },
          {
            label: "boolean align",
            documentation:
              "if 1, the scope will be aligned to the first zero crossing. defaults to 1",
          },
          {
            label: "string color",
            documentation:
              "line color as hex or color name. defaults to white.",
          },
          {
            label: "number thickness",
            documentation: "line thickness. defaults to 3",
          },
          {
            label: "number scale",
            documentation: "scales the y-axis. Defaults to 0.25",
          },
          {
            label: "number pos",
            documentation:
              "y-position relative to screen height. 0 = top, 1 = bottom of screen",
          },
          {
            label: "number trigger",
            documentation:
              "amplitude value that is used to align the scope. defaults to 0.",
          },
        ],
      },
    ],
  },
  {
    name: "spectrum",
    detail: "spectrum/visualization",
    documentation: "Renders a spectrum analyzer for the incoming audio signal.",
    signatures: [
      {
        label: "spectrum(config, thickness, speed, min, max)",
        parameters: [
          {
            label: "object config",
            documentation: "optional config with options:",
          },
          {
            label: "integer thickness",
            documentation: "line thickness in px (default 3)",
          },
          {
            label: "integer speed",
            documentation: "scroll speed (default 1)",
          },
          {
            label: "integer min",
            documentation: "min db (default -80)",
          },
          {
            label: "integer max",
            documentation: "max db (default 0)",
          },
        ],
      },
    ],
  },
  {
    name: "tune",
    detail: "Pattern.tune/tonal",
    documentation:
      "Deprecated.\n\nAssumes pattern contains numerical scale degrees on the i control (see examples\nbelow). Accepts a scale name or list of frequencies (see all available names at\nthe link on the reference). Returns a new pattern with all values mapped to a\nfrequency ratio. Similar to xen.",
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
      "Assumes a numerical pattern of scale steps, and a scale. Scales accepted are all\npreset scale names of tune, arbitrary edos such as 31edo, or an array of\nfrequency ratios. Assumes scales repeat at octave (2/1). Returns a new pattern\nwith all values mapped to their associated frequency, assuming a base frequency\nof 220hz. See first 4 examples for the different ways you can input a scale into\nxen",
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
      "Assumes pattern of frequencies tuned to some base frequency, such as the output\nof xen Because xen defaults to 220Hz, so will withBase. but you can specify a\ndifferent original base with the standard optional array syntax ':'",
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
            documentation: "originalBase",
          },
        ],
      },
    ],
  },
  {
    name: "ftranspose",
    detail: "ftranspose/tonal",
    documentation:
      'Frequency transpose. Assumes pattern either has freq set, or has values that can\nbe interpreted as frequencies amt has optional edoSize param, defaults to 12. If\nhaps have edoSize param set, such as from the output of xen("31edo"), ftrans\nwill fallback to that instead of 12 as the default.\n\nTransposes the frequency by amt edoSteps',
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
            documentation: "(optional)",
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

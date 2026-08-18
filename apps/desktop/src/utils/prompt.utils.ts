import { getRec } from "@voquill/utilities";
import z from "zod";
import zodToJsonSchema from "zod-to-json-schema";
import { Locale } from "../i18n/config";
import { getIntl } from "../i18n/intl";
import { AppState } from "../state/app.state";
import {
  DictationLanguageCode,
  getDisplayNameForLanguage,
  LANGUAGE_DISPLAY_NAMES,
} from "./language.utils";
import { ToneConfig } from "./tone.utils";
import { getMyUserName } from "./user.utils";

const sanitizeGlossaryValue = (value: string): string =>
  // oxlint-disable-next-line no-control-regex
  value.replace(/\0/g, "").replace(/\s+/g, " ").trim();

export const collectDictionaryEntries = (
  state: AppState,
): DictionaryEntries => {
  const sources = new Map<string, string>();
  const replacements = new Map<string, ReplacementRule>();

  const recordSource = (candidate: string): string | null => {
    const sanitized = sanitizeGlossaryValue(candidate);
    if (!sanitized) {
      return null;
    }

    const key = sanitized.toLowerCase();
    if (!sources.has(key)) {
      sources.set(key, sanitized);
    }

    return sources.get(key) ?? sanitized;
  };

  const recordReplacement = (source: string, destination: string) => {
    const sanitizedSource = recordSource(source);
    const sanitizedDestination = sanitizeGlossaryValue(destination);

    if (!sanitizedSource || !sanitizedDestination) {
      return;
    }

    const key = `${sanitizedSource.toLowerCase()}→${sanitizedDestination.toLowerCase()}`;
    if (!replacements.has(key)) {
      replacements.set(key, {
        source: sanitizedSource,
        destination: sanitizedDestination,
      });
    }
  };

  for (const termId of state.dictionary.termIds) {
    const term = state.termById[termId];
    if (!term) {
      continue;
    }

    if (term.isReplacement) {
      recordReplacement(term.sourceValue, term.destinationValue);
    } else {
      recordSource(term.sourceValue);
    }
  }

  // These should always be added to the vocabulary
  recordSource("Voquill");
  recordSource(getMyUserName(state));

  return {
    sources: Array.from(sources.values()),
    replacements: Array.from(replacements.values()),
  };
};

function applyTemplateVars(
  template: string,
  vars: [name: string, value: string][],
): string {
  let result = template;
  for (const [name, value] of vars) {
    result = result.replace(new RegExp(`<${name}\\/>`, "g"), value);
  }
  return result;
}

export type PostProcessingPromptInput = {
  transcript: string;
  userName: string;
  dictationLanguage: string;
  tone: ToneConfig;
};

const buildPostProcessingTemplateVars = (
  input: PostProcessingPromptInput,
): [name: string, value: string][] => {
  const languageName = getDisplayNameForLanguage(input.dictationLanguage);
  return [
    ["username", input.userName],
    ["transcript", input.transcript],
    ["language", languageName],
  ];
};

const getStylePrompt = (input: PostProcessingPromptInput): string => {
  if (input.tone.kind === "style") {
    return input.tone.stylePrompt;
  }
  return "Clean up the provided transcript";
};

export const buildSystemPostProcessingTonePrompt = (
  input: PostProcessingPromptInput,
): string => {
  if (input.tone.kind === "template" && input.tone.systemPromptTemplate) {
    return applyTemplateVars(
      input.tone.systemPromptTemplate,
      buildPostProcessingTemplateVars(input),
    );
  }

  const stylePrompt = getStylePrompt(input);
  const languageName = getDisplayNameForLanguage(input.dictationLanguage);
  const fullPrompt = `
${stylePrompt}
The result must be in the ${languageName} language.
Respond with JSON only: { "result": "<processed-transcript>" }
`;

  return applyTemplateVars(
    fullPrompt.trim(),
    buildPostProcessingTemplateVars(input),
  );
};

type ReplacementRule = {
  source: string;
  destination: string;
};

export type DictionaryEntries = {
  sources: string[];
  replacements: ReplacementRule[];
};

/**
 * It is necessary to provide a transcription prompt per language. Some whisper models are biased by
 * which prompt the language is written in, causing output to be in english even if the audio and
 * specified language are in a different language. By providing a prompt in the language being
 * transcribed, we can encourage the model to produce output in the correct language.
 *
 * These are vocabulary hints, never instructions. Transcription models continue the prompt rather
 * than obey it, so a prompt that asks the model to behave gets transcribed back verbatim — an
 * earlier version ending in "Do not mention these rules" produced exactly that sentence, and
 * "Sure, I'll keep the glossary in mind.", as transcripts.
 */
const transcriptionPromptByCode: Record<DictationLanguageCode, string> = {
  auto: "Glossary: <glossary/>",
  en: "Glossary: <glossary/>",
  zh: "词汇表：<glossary/>",
  "zh-TW": "詞彙表：<glossary/>",
  "zh-HK": "詞彙表：<glossary/>",
  "zh-CN": "词汇表：<glossary/>",
  de: "Glossar: <glossary/>",
  es: "Glosario: <glossary/>",
  ru: "Глоссарий: <glossary/>",
  ko: "용어집: <glossary/>",
  fr: "Glossaire : <glossary/>",
  ja: "用語集：<glossary/>",
  pt: "Glossário: <glossary/>",
  "pt-PT": "Glossário: <glossary/>",
  "pt-BR": "Glossário: <glossary/>",
  tr: "Sözlük: <glossary/>",
  pl: "Słownik: <glossary/>",
  ca: "Glossari: <glossary/>",
  nl: "Woordenlijst: <glossary/>",
  ar: "قائمة المصطلحات: <glossary/>",
  sv: "Ordlista: <glossary/>",
  it: "Glossario: <glossary/>",
  id: "Glosarium: <glossary/>",
  hi: "शब्दावली: <glossary/>",
  fi: "Sanasto: <glossary/>",
  vi: "Bảng thuật ngữ: <glossary/>",
  he: "מילון מונחים: <glossary/>",
  uk: "Глосарій: <glossary/>",
  el: "Γλωσσάρι: <glossary/>",
  ms: "Glosari: <glossary/>",
  cs: "Slovník: <glossary/>",
  ro: "Glosar: <glossary/>",
  da: "Ordliste: <glossary/>",
  hu: "Szójegyzék: <glossary/>",
  ta: "சொற்களஞ்சியம்: <glossary/>",
  no: "Ordliste: <glossary/>",
  th: "อภิธานศัพท์: <glossary/>",
  ur: "فرہنگ: <glossary/>",
  hr: "Pojmovnik: <glossary/>",
  bg: "Речник: <glossary/>",
  lt: "Žodynas: <glossary/>",
  la: "Glossarium: <glossary/>",
  mi: "Kuputaka: <glossary/>",
  ml: "പദാവലി: <glossary/>",
  cy: "Geirfa: <glossary/>",
  sk: "Slovník: <glossary/>",
  te: "పదకోశం: <glossary/>",
  fa: "واژه‌نامه: <glossary/>",
  lv: "Vārdnīca: <glossary/>",
  bn: "শব্দকোষ: <glossary/>",
  sr: "Речник: <glossary/>",
  az: "Lüğət: <glossary/>",
  sl: "Slovar: <glossary/>",
  kn: "ಪದಕೋಶ: <glossary/>",
  et: "Sõnastik: <glossary/>",
  mk: "Речник: <glossary/>",
  br: "Geriadur: <glossary/>",
  eu: "Glosarioa: <glossary/>",
  is: "Orðalisti: <glossary/>",
  hy: "Բառարան: <glossary/>",
  ne: "शब्दकोश: <glossary/>",
  mn: "Тайлбар толь: <glossary/>",
  bs: "Glosar: <glossary/>",
  kk: "Глоссарий: <glossary/>",
  sq: "Fjalorth: <glossary/>",
  sw: "Kamusi: <glossary/>",
  gl: "Glosario: <glossary/>",
  mr: "शब्दकोश: <glossary/>",
  pa: "ਸ਼ਬਦਾਵਲੀ: <glossary/>",
  si: "ශබ්දකෝෂය: <glossary/>",
  km: "វចនានុក្រម: <glossary/>",
  sn: "Dudziramazwi: <glossary/>",
  yo: "Àtòjọ ọ̀rọ̀: <glossary/>",
  so: "Eraykoob: <glossary/>",
  af: "Woordelys: <glossary/>",
  oc: "Glossari: <glossary/>",
  ka: "ლექსიკონი: <glossary/>",
  be: "Гласарый: <glossary/>",
  tg: "Луғат: <glossary/>",
  sd: "لغت: <glossary/>",
  gu: "શબ્દકોશ: <glossary/>",
  am: "የቃላት ዝርዝር: <glossary/>",
  yi: "גלאסאר: <glossary/>",
  lo: "ວັດຈະນານຸກົມ: <glossary/>",
  uz: "Lug'at: <glossary/>",
  fo: "Orðalisti: <glossary/>",
  ht: "Glosè: <glossary/>",
  ps: "لغت: <glossary/>",
  tk: "Sözlük: <glossary/>",
  nn: "Ordliste: <glossary/>",
  mt: "Glossarju: <glossary/>",
  sa: "शब्दकोशः: <glossary/>",
  lb: "Glossar: <glossary/>",
  my: "ဝေါဟာရစာရင်း: <glossary/>",
  bo: "ཚིག་མཛོད: <glossary/>",
  tl: "Talasalitaan: <glossary/>",
  mg: "Rakibolana: <glossary/>",
  as: "শব্দকোষ: <glossary/>",
  tt: "Сүзлек: <glossary/>",
  haw: "Papa huaʻōlelo: <glossary/>",
  ln: "Dikisionalɛ: <glossary/>",
  ha: "Ƙamus: <glossary/>",
  ba: "Глоссарий: <glossary/>",
  jw: "Glosarium: <glossary/>",
  su: "Glosarium: <glossary/>",
  yue: "詞彙表：<glossary/>",
};

export const buildLocalizedTranscriptionPrompt = (args: {
  entries: DictionaryEntries;
  dictationLanguage: DictationLanguageCode;
  state: AppState;
}): string => {
  const joinedEntries = args.entries.sources.join(", ");
  const prompt =
    getRec(transcriptionPromptByCode, args.dictationLanguage) ??
    transcriptionPromptByCode.en;
  return applyTemplateVars(prompt, [["glossary", joinedEntries]]);
};

export const buildPostProcessingPrompt = (
  input: PostProcessingPromptInput,
): string => {
  const { transcript, tone } = input;
  if (tone.kind === "template") {
    return applyTemplateVars(
      tone.promptTemplate,
      buildPostProcessingTemplateVars(input),
    );
  }

  return `
Here is the transcript:

<transcript>
${transcript}
</transcript>

Process the transcript according to the instructions.
`.trim();
};

export const PROCESSED_TRANSCRIPTION_SCHEMA = z.object({
  result: z.string().describe("The processed transcription"),
});

export const PROCESSED_TRANSCRIPTION_JSON_SCHEMA =
  zodToJsonSchema(PROCESSED_TRANSCRIPTION_SCHEMA, "Schema").definitions
    ?.Schema ?? {};

export const buildSystemAgentPrompt = (): string => {
  return "You are a helpful AI assistant that executes user commands. The user will dictate instructions via voice, and you will execute those instructions and return the output. Your job is to understand what the user wants and produce it. Examples: 'write a poem about cats' → write the poem; 'summarize this article' → provide the summary; 'create a shopping list' → create the list; 'draft an email to my boss' → draft the email. Always return just the requested output, ready to be pasted.";
};

export const buildLocalizedAgentPrompt = (
  transcript: string,
  locale: Locale,
  toneTemplate?: string | null,
): string => {
  const intl = getIntl(locale);
  const languageName = LANGUAGE_DISPLAY_NAMES[locale];

  // Use tone template if provided to adjust the agent's response style
  let base: string;
  if (toneTemplate) {
    base = `
The user has dictated the following command or request. Follow it precisely.

Style instructions to apply to your response:
\`\`\`
${toneTemplate}
\`\`\`

Here is what the user dictated:
-------
${transcript}
-------

Execute the command and provide your response in ${languageName}.
`;
    console.log(
      "[Agent Prompt] Using tone template, result length:",
      base.length,
    );
  } else {
    console.log("[Agent Prompt] Using default prompt (no tone template)");
    base = intl.formatMessage(
      {
        defaultMessage: `
The user has dictated the following command:
-------
{transcript}
-------

Execute this command and provide the output in {languageName}.

Instructions:
- If the user asks you to write, create, draft, or compose something → produce that content
- If the user asks you to summarize, analyze, or explain something → provide the summary/analysis/explanation
- If the user asks you to transform or rewrite something → apply the transformation
- If the user provides a statement without a clear command → clean it up and present it clearly

Return ONLY the requested output, nothing else. The output will be pasted directly into the user's application.
        `,
      },
      {
        languageName,
        transcript,
      },
    );
  }

  console.log("Agent prompt", prompt);
  return base;
};

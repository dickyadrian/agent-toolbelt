import { describe, expect, test } from 'claude-code/testing'
import {
  appendLines,
  argumentsText,
  createdIds,
  dateOf,
  decide,
  entryLine,
  extractIds,
  NO_IDS,
  parseAllowlist,
  toolNameOf,
  uploadIds,
} from '../hooks/scope'

const PAGE = '3df99635e86680e491fec984efbb7057'
const OTHER = '3e299635e866809dadb2d84aa544ac43'
const DASHED = '3df99635-e866-80e4-91fe-c984efbb7057'

describe('extractIds', () => {
  test('finds plain, dashed and uppercase ids, normalized', () => {
    expect(extractIds(`${PAGE} ${DASHED.toUpperCase()} ${OTHER}`)).toEqual([PAGE, OTHER])
  })

  test('finds the id at the end of a Notion URL', () => {
    expect(extractIds(`https://www.notion.so/Agentic-Observability-Research-${OTHER}?pvs=4`)).toEqual([OTHER])
  })

  test('skips user mentions and database views', () => {
    expect(extractIds(`<mention-user url="user://${OTHER}"/> https://notion.so/${PAGE}?v=${OTHER}`)).toEqual([PAGE])
  })

  test('skips 32 hex digits inside a longer hex run', () => {
    expect(extractIds(`commit ${PAGE}abcdef01`)).toEqual([])
  })

  test('finds nothing in plain text', () => {
    expect(extractIds('Agentic Observability Exploration')).toEqual([])
  })
})

describe('parseAllowlist', () => {
  test('reads ids and URLs, skipping comments, labels and blank lines', () => {
    const NEW = '3e399635e86680e491fec984efbb7057'
    const text = [
      '# One Notion page/block id per line.',
      `# ${OTHER} in a comment does not count`,
      '',
      `${PAGE}  # created by Claude 2026-10-13`,
      `https://www.notion.so/Research-${NEW}`,
      'not an id',
    ].join('\n')

    expect([...parseAllowlist(text)]).toEqual([PAGE, NEW])
  })

  test('an empty file allows nothing', () => {
    expect(parseAllowlist('').size).toBe(0)
  })
})

describe('toolNameOf', () => {
  test('drops the server part of either spelling', () => {
    expect(toolNameOf('mcp__claude_ai_Notion__notion-fetch')).toBe('notion-fetch')
    expect(toolNameOf('mcp__notion__notion-fetch')).toBe('notion-fetch')
  })
})

describe('argumentsText', () => {
  test('leaves out the engine fields', () => {
    expect(argumentsText({ tool: 'mcp__notion__notion-fetch', tool_use_id: 't1', agentId: 'a1', id: PAGE })).toBe(
      JSON.stringify({ id: PAGE }),
    )
  })
})

describe('decide', () => {
  const allowed = new Set([PAGE])

  test('denies a call that names no page', () => {
    expect(decide('mcp__notion__notion-search', [], allowed)).toBe(NO_IDS)
  })

  test('denies a call naming a page outside the allowlist, naming it', () => {
    expect(decide('mcp__notion__notion-fetch', [PAGE, OTHER], allowed)).toContain(OTHER)
  })

  test('allows a call naming only allowed pages', () => {
    expect(decide('mcp__notion__notion-fetch', [PAGE], allowed)).toBeUndefined()
  })

  test('allows the unscoped tools with or without ids', () => {
    expect(decide('mcp__notion__notion-create-file-upload', [], allowed)).toBeUndefined()
    expect(decide('mcp__claude_ai_Notion__notion-get-async-task', [OTHER], allowed)).toBeUndefined()
    expect(decide('mcp__notion__notion-get-self', [], allowed)).toBeUndefined()
  })
})

describe('createdIds', () => {
  test('reads ids from a pages array and the top level', () => {
    const text = JSON.stringify({ pages: [{ id: OTHER, url: `https://www.notion.so/${OTHER}`, properties: { title: PAGE } }] })

    expect(createdIds(text)).toEqual([OTHER])
  })

  test('reads a duplicate result', () => {
    expect(createdIds(JSON.stringify({ page_id: DASHED, page_url: `https://notion.so/x-${PAGE}` }))).toEqual([PAGE])
  })

  test('never reads content or properties', () => {
    expect(createdIds(JSON.stringify({ content: `see ${OTHER}`, properties: { link: OTHER } }))).toEqual([])
  })

  test('reads nothing from text that is not JSON', () => {
    expect(createdIds(`Created page ${OTHER}`)).toEqual([])
  })
})

describe('uploadIds', () => {
  test('reads the upload id from a create-file-upload result', () => {
    expect(uploadIds(JSON.stringify({ file_upload_id: DASHED, filename: 'a.png' }))).toEqual([PAGE])
  })
})

describe('lines', () => {
  test('dateOf is the local day', () => {
    expect(dateOf(new Date(2026, 9, 13, 23, 59).getTime())).toBe('2026-10-13')
  })

  test('entryLine puts the label after the id as a comment', () => {
    expect(entryLine(PAGE, 'created by Claude 2026-10-13')).toBe(`${PAGE}  # created by Claude 2026-10-13`)
  })

  test('appendLines adds a missing newline first', () => {
    expect(appendLines('a', ['b'])).toBe('a\nb\n')
    expect(appendLines('a\n', ['b', 'c'])).toBe('a\nb\nc\n')
    expect(appendLines('', ['b'])).toBe('b\n')
  })
})

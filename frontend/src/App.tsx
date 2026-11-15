import { createContext, FormEvent, ReactNode, useContext, useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import './analysis.css'
import './local-log.css'
import './aura-coverage.css'
import './long-buff.css'
import './upload-analysis.css'
import './debuff-applications.css'
import './themes.css'
import './branding.css'
import './live-updates.css'
import { changeLiveInterval, defaultSessionMinutes, isLiveSessionActive, readLiveSession, refreshIntervals, sessionDurations, startLiveSession } from './live-session'
import { bossGuideFor, type BossGuide } from './boss-guides'
import { Activity, ArrowLeft, ArrowUpRight, Check, CircleHelp, Clock3, ExternalLink, LoaderCircle, ScrollText, Shield, Skull, Swords, Trophy } from 'lucide-react'

type Health = { status: string; service: string }
type Brand = { portal_name: string; tagline: string; logo_url: string; primary_color: string; accent_color: string }
type PublicConfig = { brand: Brand }
const defaultBrand: Brand = {
  portal_name: 'Logtastiq',
  tagline: 'Turn Warcraft Logs into clear next steps.',
  logo_url: '',
  primary_color: '#f2c14e',
  accent_color: '#e7a7c3',
}
const BrandContext = createContext<Brand>(defaultBrand)

async function fetchPublicConfig(): Promise<PublicConfig> {
  const response = await fetch('/api/config')
  if (!response.ok) throw new Error('Public app configuration unavailable')
  return response.json()
}

type Fight = {
  fight_id: number
  encounter_id: number
  difficulty: number | null
  name: string
  start_time_ms: number
  end_time_ms: number
  duration_ms: number
  kill: boolean | null
  fight_percentage: number | null
  friendly_players: number[]
}
type Boss = { encounter_id: number; name: string; attempts: number; kills: number; wipes: number; fights: Fight[] }
type Report = {
  code: string
  title: string
  zone: string | null
  zone_id: number | null
  guild: string | null
  start_time: string
  end_time: string
  duration_ms: number
  fight_count: number
  boss_count: number
  kill_count: number
  wipe_count: number
  bosses: Boss[]
  fights: Fight[]
}
type Actor = { id: number; name: string; type: string; subType: string | null; specName?: string | null }
type FightAnalysis = { fight: Fight; tables: Record<string, unknown>; events: Record<string, unknown>; player_details: unknown; actors: Actor[]; enemy_actors?: Actor[]; abilities?: Array<{ gameID?: number | string; id?: number | string; guid?: number | string; name: string }>; rankings?: { recent_parses: unknown; best_rankings: unknown } }
type BenchmarkCandidate = { report_code: string; fight_id: number; title: string | null; guild: string | null; duration_seconds: number | null; fight_percentage?: number | null; rank_percent: number | null; composition_similarity: number | null; average_item_level: number | null; item_level_difference: number | null; matched_specs?: string[]; url: string }
type BenchmarkReference = { report_code: string; fight_id: number; title: string | null; fight: Fight; actors: Actor[]; player_specs: Record<string, string>; tables: Record<string, unknown>; events: Record<string, unknown>; player_details?: unknown }
type Benchmarks = { status: 'available' | 'empty' | 'unavailable'; encounter: string | null; strictness: string; cohort_source: string; source: string; sample_size: number; match_basis: string[]; limitations: string[]; candidates: BenchmarkCandidate[]; reference_analyses: BenchmarkReference[] }
type AbilityUptime = { name: string; percent: number | null }
type PreparationAura = { name: string; source: string; selfApplied: boolean }
type SpellUse = { name: string; count: number }
type LocalDebuff = { spell_id: number; ability: string; target: string; provider: string; provider_is_player: boolean; target_is_boss: boolean; uptime_seconds: number; uptime_percent: number; fight_duration_seconds: number; applications: number; armor_reduction: number; armor_reduction_note?: string }
type LocalBuffPlayer = { id: string; name: string; uptime_seconds: number; uptime_percent: number; present_before_pull: boolean; status: string }
type LocalBuff = { ability: string; covered_players: number; roster_size: number; players: LocalBuffPlayer[] }
type LocalDamageSource = { source: string; ability: string; damage_type: string; amount: number; hits: number }
type LocalBossCast = { timestamp_seconds: number; source: string; ability: string; status: 'completed' | 'interrupted' | 'unknown'; priority: 'critical' | 'high' | 'review'; reason: string | null; interrupted_by?: string; cast_ms: number }
type LocalEncounter = { id: string; name: string; kill: boolean | null; duration_seconds: number; roster: Array<{ id: string; name: string }>; debuffs: LocalDebuff[]; long_buffs: LocalBuff[]; raid_buffs: Array<{ family: string; ability: string; target: string; provider: string; uptime_seconds: number; uptime_percent: number }>; deaths: Array<{ timestamp_seconds: number; player: string; last_hit: LocalDamageSource | null }>; damage_sources: Array<{ player: string; sources: LocalDamageSource[] }>; boss_casts: LocalBossCast[]; armor_reduction: Array<{ ability: string; estimated_armor_reduction: number; uptime_seconds: number; targets: number }> }
type LocalLog = { file_name: string; encounter_count: number; line_count: number; encounters: LocalEncounter[] }
type PlayerStats = Actor & { specName: string | null; durationSeconds: number; casts: SpellUse[]; damage: number | null; dps: number | null; healing: number | null; hps: number | null; damageTaken: number | null; damageTakenSources: LocalDamageSource[]; friendlyDamage: number | null; friendlyDamageReliable: boolean; friendlyDamageAbilities: Array<{ name: string; amount: number; hits: number }>; deaths: Array<Record<string, unknown>>; interrupts: Array<Record<string, unknown>>; interruptsAvailable: boolean; consumables: string[]; gear: Array<Record<string, unknown>>; averageItemLevel: number | null; enchantCount: number | null; gemCount: number | null; auras: string[]; preparationAuras: PreparationAura[]; uptimes: AbilityUptime[]; uptimeAverage: number | null; recentPercentile: number | null; bestPercentile: number | null }

async function getHealth(): Promise<Health> {
  const response = await fetch('/api/health')
  if (!response.ok) throw new Error('API unavailable')
  return response.json()
}

async function parseReportURL(reportUrl: string): Promise<{ report_code: string }> {
  const response = await fetch('/api/reports/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ report_url: reportUrl }),
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.detail ?? 'Could not read that report URL.')
  return payload
}

async function fetchReport(code: string, refresh = false): Promise<Report> {
  const response = await fetch(`/api/reports/${encodeURIComponent(code)}${refresh ? '?refresh=true' : ''}`, { cache: refresh ? 'no-store' : 'default' })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.detail ?? 'Could not load this report.')
  return payload
}

async function fetchFights(code: string): Promise<Fight[]> {
  const response = await fetch(`/api/reports/${encodeURIComponent(code)}/fights`)
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.detail ?? 'Could not load fight progression.')
  return payload
}

async function fetchFightAnalysis(code: string, fightId: number): Promise<FightAnalysis> {
  const response = await fetch(`/api/reports/${encodeURIComponent(code)}/fights/${fightId}/analysis`)
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.detail ?? 'Could not load fight analysis.')
  return payload
}

async function fetchBenchmarks(code: string, fightId: number, strictness: string, source: string): Promise<Benchmarks> {
  const response = await fetch(`/api/reports/${encodeURIComponent(code)}/fights/${fightId}/benchmarks?strictness=${strictness}&source=${source}`)
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.detail ?? 'Could not load comparable logs.')
  return payload
}

async function uploadCombatLog(file: File): Promise<LocalLog> {
  const body = new FormData()
  let uploadFile = file
  let uploadName = file.name
  if (file.size > 10 * 1024 * 1024) {
    if (typeof CompressionStream === 'undefined') throw new Error('This browser cannot compress a large log. Try a current version of Chrome, Edge, or Firefox.')
    const stream = file.stream().pipeThrough(new CompressionStream('gzip'))
    uploadFile = new File([await new Response(stream).blob()], `${file.name}.gz`, { type: 'application/gzip' })
    uploadName = uploadFile.name
  }
  body.append('file', uploadFile, uploadName)
  const response = await fetch('/api/reports/local/analyze', { method: 'POST', body })
  const payload = await response.json().catch(() => ({ detail: `Upload server returned a non-JSON response (HTTP ${response.status}). Large logs are compressed before upload; check the network/proxy size limit if this persists.` }))
  if (!response.ok) throw new Error(payload.detail ?? 'Could not analyze this combat log.')
  return payload
}

function parseJSON(value: unknown): unknown {
  let parsed = value
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed) } catch { return value }
  }
  return parsed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function tableRows(value: unknown, depth = 0): Array<Record<string, unknown>> {
  const parsed = parseJSON(value)
  if (depth > 7 || parsed === null || parsed === undefined) return []
  if (Array.isArray(parsed)) {
    const records = parsed.filter(isRecord)
    if (records.some((row) => ['name', 'id', 'guid', 'total', 'totalUptime', 'amount', 'timestamp', 'sourceID', 'targetID', 'type', 'ability'].some((key) => row[key] !== undefined))) return records
    return records.flatMap((row) => tableRows(row, depth + 1))
  }
  if (!isRecord(parsed)) return []
  for (const key of ['data', 'entries', 'events', 'actors', 'auras', 'table', 'series', 'groups', 'sources', 'targets', 'players']) {
    if (parsed[key] !== undefined) {
      const rows = tableRows(parsed[key], depth + 1)
      if (rows.length) return rows
    }
  }
  return []
}

function eventDataAvailable(value: unknown): boolean {
  if (value === null || value === undefined) return false
  const parsed = parseJSON(value)
  if (isRecord(parsed) && 'data' in parsed) return parsed.data !== null && parsed.data !== undefined
  return true
}

function eventDataComplete(value: unknown): boolean {
  const parsed = parseJSON(value)
  return isRecord(parsed) && 'data' in parsed && parsed.data !== null && parsed.data !== undefined && parsed.nextPageTimestamp === null
}

function allRecords(value: unknown, output: Array<Record<string, unknown>> = [], depth = 0): Array<Record<string, unknown>> {
  const parsed = parseJSON(value)
  if (depth > 9 || parsed === null || parsed === undefined) return output
  if (Array.isArray(parsed)) {
    for (const item of parsed) allRecords(item, output, depth + 1)
  } else if (isRecord(parsed)) {
    output.push(parsed)
    for (const item of Object.values(parsed)) allRecords(item, output, depth + 1)
  }
  return output
}

function damageTakenBreakdown(row: Record<string, unknown> | undefined): LocalDamageSource[] {
  if (!row) return []
  const result = new Map<string, LocalDamageSource>()
  for (const record of allRecords(row).slice(1)) {
    const nestedAbility = isRecord(record.ability) ? record.ability : null
    const ability = String(nestedAbility?.name ?? record.name ?? '')
    const amount = numericValue(record, ['total', 'amount', 'damage'])
    if (!ability || amount === null || amount <= 0) continue
    const source = typeof record.sourceName === 'string' ? record.sourceName : isRecord(record.source) && typeof record.source.name === 'string' ? record.source.name : ''
    const damageType = damageSchoolLabel(record.damageType ?? record.schoolName ?? record.school) ?? ''
    const key = `${source}:${ability}:${damageType}`
    const current = result.get(key) ?? { source, ability, damage_type: damageType, amount: 0, hits: 0 }
    current.amount += amount
    current.hits += numericValue(record, ['hits', 'hitCount', 'count']) ?? 0
    result.set(key, current)
  }
  return [...result.values()].sort((a, b) => b.amount - a.amount).slice(0, 8)
}

function damageSchoolLabel(value: unknown): string | null {
  if (typeof value === 'string' && value && !/^death$/i.test(value)) return value
  const numericSchool = typeof value === 'number' ? value : typeof value === 'string' && /^0x[\da-f]+$/i.test(value) ? Number.parseInt(value, 16) : null
  if (numericSchool === null || !Number.isFinite(numericSchool)) return null
  const schoolTypes: Array<[number, string]> = [[1, 'Physical'], [2, 'Holy'], [4, 'Fire'], [8, 'Nature'], [16, 'Frost'], [32, 'Shadow'], [64, 'Arcane']]
  const schools = schoolTypes.filter(([mask]) => numericSchool & mask).map(([, label]) => label)
  return schools.length ? schools.join('/') : null
}

function actorId(row: Record<string, unknown>, role?: 'source' | 'target'): number | null {
  const nested = role && isRecord(row[role]) ? row[role] as Record<string, unknown> : null
  const value = (role === 'source' ? row.sourceID ?? row.sourceId : role === 'target' ? row.targetID ?? row.targetId : undefined)
    ?? row.id ?? row.actorID ?? row.actorId ?? nested?.id
  const id = Number(value)
  return Number.isFinite(id) ? id : null
}

function actorName(row: Record<string, unknown>, role?: 'source' | 'target', actors: Actor[] = []): string {
  const nested = role && isRecord(row[role]) ? row[role] as Record<string, unknown> : null
  const value = (role === 'source' ? row.sourceName : role === 'target' ? row.targetName : row.name)
    ?? nested?.name
  if (typeof value === 'string' && value.length) return value
  const id = role ? actorId(row, role) : null
  return actors.find((actor) => actor.id === id)?.name ?? 'Unknown'
}

function eventAbilityName(row: Record<string, unknown>, abilities: Array<{ gameID?: number | string; id?: number | string; guid?: number | string; name: string }> = []): string {
  const nestedAbility = isRecord(row.ability) ? row.ability : null
  const directName = nestedAbility?.name ?? row.abilityName ?? row.name
  if (typeof directName === 'string' && directName.length) return directName
  const abilityId = Number(row.abilityGameID ?? row.abilityGameId ?? row.abilityID ?? row.abilityId ?? nestedAbility?.gameID ?? nestedAbility?.guid ?? nestedAbility?.id ?? (typeof row.ability === 'number' || typeof row.ability === 'string' ? row.ability : undefined))
  const match = abilities.find((ability) => [ability.gameID, ability.id, ability.guid].some((id) => id !== undefined && Number(id) === abilityId))
  return match?.name ?? (Number.isFinite(abilityId) ? `Ability ${abilityId}` : 'Unknown ability')
}

function deathKillingAbilityName(row: Record<string, unknown>, abilities: NonNullable<FightAnalysis['abilities']> = []): string | null {
  const killingAbility = row.killingAbility ?? row.killingBlow
  if (typeof killingAbility === 'string' && killingAbility) return killingAbility
  if (isRecord(killingAbility)) {
    const name = eventAbilityName({ ability: killingAbility }, abilities)
    if (name !== 'Unknown ability') return name
  }
  const killingAbilityId = row.killingAbilityGameID ?? row.killingAbilityGameId ?? row.killingAbilityID ?? row.killingAbilityId
  if (killingAbilityId !== null && killingAbilityId !== undefined) {
    const name = eventAbilityName({ abilityGameID: killingAbilityId }, abilities)
    if (name !== 'Unknown ability') return name
  }
  const ability = eventAbilityName(row, abilities)
  return ability === 'Unknown ability' || ability === 'Ability 0' || ability === 'Death' ? null : ability
}

function deathKillerName(row: Record<string, unknown>, actors: Actor[]): string {
  const killer = isRecord(row.killer) ? row.killer : null
  const directName = row.killerName ?? killer?.name
  if (typeof directName === 'string' && directName) return directName
  const killerId = Number(row.killerID ?? row.killerId ?? killer?.id)
  return Number.isFinite(killerId) ? actors.find((actor) => actor.id === killerId)?.name ?? 'Unknown' : actorName(row, 'source', actors)
}

function enemyDamageAbilityNames(value: unknown, enemies: Actor[]): string[] {
  const enemyIds = new Set(enemies.map((actor) => actor.id))
  return tableRows(value).filter((row) => enemyIds.has(actorId(row) ?? -1)).flatMap((row) => Array.isArray(row.abilities) ? row.abilities.filter(isRecord).map((ability) => String(ability.name ?? '')).filter(Boolean) : [])
}

function guideAbilityMatch(observed: string, guideName: string): boolean {
  const observedName = observed.toLowerCase().replace(/[^a-z0-9]/g, '')
  return guideName.split(/[\/,]/).map((part) => part.toLowerCase().replace(/[^a-z0-9]/g, '')).some((term) => term.length > 3 && (observedName.includes(term) || term.includes(observedName)))
}

function rowForActor(value: unknown, actor: Actor, role?: 'source' | 'target'): Record<string, unknown> | undefined {
  return tableRows(value).find((row) => actorId(row, role) === actor.id || (actorId(row, role) === null && actorName(row, role) === actor.name))
}

function rankingPercentile(value: unknown, actor: Actor): number | null {
  const rows = allRecords(value)
  for (const row of rows) {
    const names = [row.name, row.characterName, row.playerName, row.sourceName].filter((item): item is string => typeof item === 'string')
    const ids = [row.id, row.actorID, row.actorId, row.sourceID, row.sourceId].map(Number)
    if (!names.includes(actor.name) && !ids.includes(actor.id)) continue
    for (const key of ['rankPercent', 'rankPercentile', 'percentile', 'parsePercentile']) {
      const result = Number(row[key])
      if (Number.isFinite(result) && result >= 0 && result <= 100) return result
    }
  }
  return null
}

function numericValue(row: Record<string, unknown> | undefined, keys: string[]): number | null {
  for (const key of keys) {
    const value = row?.[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (isRecord(value)) {
      const nested = Object.values(value).find((item) => typeof item === 'number')
      if (typeof nested === 'number') return nested
    }
  }
  return null
}

function spellUses(value: unknown, actorName: string): SpellUse[] {
  const counts = new Map<string, number>()
  for (const row of allRecords(value)) {
    const nestedAbility = isRecord(row.ability) ? row.ability : null
    const nameValue = nestedAbility?.name ?? row.name
    if (typeof nameValue !== 'string' || !nameValue || nameValue === actorName || (!nestedAbility && row.guid === undefined && row.abilityGameID === undefined && row.abilityGameId === undefined && row.id === undefined)) continue
    let count: number | null = null
    for (const key of ['casts', 'castCount', 'uses', 'count', 'total']) {
      const candidate = row[key]
      if (typeof candidate === 'number' && Number.isFinite(candidate)) { count = candidate; break }
      if (isRecord(candidate) && typeof candidate.casts === 'number') { count = candidate.casts; break }
    }
    if (count !== null && count > 0) counts.set(nameValue, (counts.get(nameValue) ?? 0) + count)
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count }))
}

function makePlayerStats(analysis: FightAnalysis): PlayerStats[] {
  const participants = new Set(analysis.fight.friendly_players)
  const deaths = tableRows(analysis.events.deaths)
  const interrupts = tableRows(analysis.events.interrupts)
  const combatantEvents = tableRows(analysis.events.combatant_info)
  const durationSeconds = analysis.fight.duration_ms / 1000
  const friendlyDamageReliable = analysis.tables.friendly_damage_complete === true
  return analysis.actors
    .filter((actor) => actor.type === 'Player' && participants.has(actor.id))
    .map((actor) => {
      const damageRow = rowForActor(analysis.tables.damage, actor, 'source')
      const healingRow = rowForActor(analysis.tables.healing, actor, 'source')
      const takenRow = rowForActor(analysis.tables.damage_taken, actor, 'target')
      const friendlyTotals = isRecord(analysis.tables.friendly_damage) ? analysis.tables.friendly_damage : {}
      const castsRow = rowForActor(analysis.tables.casts, actor, 'source')
      const playerBuffTables = isRecord(analysis.tables.player_buffs) ? analysis.tables.player_buffs : {}
      const buffRow = playerBuffTables[String(actor.id)] ?? rowForActor(analysis.tables.buff_uptimes, actor, 'target')
      const recentPercentile = rankingPercentile(analysis.rankings?.recent_parses, actor)
      const bestPercentile = rankingPercentile(analysis.rankings?.best_rankings, actor)
      const actorDeathEvents = deaths.filter((event) => actorId(event, 'target') === actor.id)
      const actorInterrupts = interrupts.filter((event) => actorId(event, 'source') === actor.id)
      const actorCombatant = combatantEvents.find((event) => actorId(event, 'source') === actor.id || actorId(event, 'target') === actor.id)
      const details = allRecords(analysis.player_details).find((record) => Number(record.id ?? record.actorID ?? record.actorId) === actor.id && (Array.isArray(record.gear) || isRecord(record.combatantInfo) || isRecord(record.combatantinfo)))
      const combatantInfo = isRecord(details?.combatantInfo) ? details.combatantInfo : isRecord(details?.combatantinfo) ? details.combatantinfo : actorCombatant
      const rawSpec = actor.specName ?? details?.specName ?? details?.spec ?? details?.specialization ?? combatantInfo?.spec
      const specName = typeof rawSpec === 'string' ? rawSpec : isRecord(rawSpec) && typeof rawSpec.name === 'string' ? rawSpec.name : null
      const friendlyDamageValue = friendlyTotals[String(actor.id)]
      const gear = Array.isArray(details?.gear) ? details.gear.filter(isRecord) : Array.isArray(combatantInfo?.gear) ? combatantInfo.gear.filter(isRecord) : []
      const itemLevels = gear.map((item) => numericValue(item, ['itemLevel', 'itemlevel', 'ilevel', 'ilvl'])).filter((level): level is number => level !== null && level > 0)
      const enchantKeys = ['permanentEnchantName', 'permanentEnchant', 'enchantName', 'enchant']
      const enchantFieldsPresent = gear.some((item) => enchantKeys.some((key) => key in item))
      const gemFieldsPresent = gear.some((item) => 'gems' in item)
      const enchantCount = enchantFieldsPresent ? gear.filter((item) => Boolean(item.permanentEnchantName ?? item.permanentEnchant ?? item.enchantName ?? item.enchant)).length : null
      const gemCount = gemFieldsPresent ? gear.reduce((count, item) => count + (Array.isArray(item.gems) ? item.gems.filter((gem) => gem !== null && gem !== 0 && gem !== '').length : 0), 0) : null
      const friendlyActorIds = new Set(analysis.actors.filter((candidate) => candidate.type === 'Player' && participants.has(candidate.id)).map((candidate) => candidate.id))
      // PlayerDetails combatantInfo carries gear and stats, while CombatantInfo events carry the pull-start aura snapshot.
      const auraSnapshot = Array.isArray(actorCombatant?.auras) ? actorCombatant.auras : Array.isArray(combatantInfo?.auras) ? combatantInfo.auras : []
      const preparationAuras = auraSnapshot.flatMap((aura) => {
        if (!isRecord(aura)) return []
        const name = String((isRecord(aura.ability) ? aura.ability.name : undefined) ?? aura.name ?? '')
        const sourceId = Number(aura.source ?? aura.sourceID ?? aura.sourceId)
        if (!name || !Number.isFinite(sourceId) || !friendlyActorIds.has(sourceId)) return []
        const source = analysis.actors.find((candidate) => candidate.id === sourceId)?.name ?? actor.name
        return [{ name, source, selfApplied: sourceId === actor.id }]
      })
      const auras = preparationAuras.map((aura) => aura.name)
      const consumablePattern = /potion|flask|elixir|well fed|food|feast|rune|healthstone|mana stone|wizard oil|sharpening|consecrated|free action|protection potion|healing power|destruction|super mana|super healing|fel mana|ironshield|dreamless sleep|nightmare seed|drums/i
      const castConsumables = allRecords(castsRow).map((record) => isRecord(record.ability) ? record.ability.name : record.name).filter((name): name is string => typeof name === 'string' && consumablePattern.test(name))
      const buffConsumables = allRecords(buffRow).map((record) => isRecord(record.ability) ? record.ability.name : record.name).filter((name): name is string => typeof name === 'string' && consumablePattern.test(name))
      const consumables = [...new Set([...castConsumables, ...buffConsumables, ...auras.filter((name) => consumablePattern.test(name))])]
      const uptimes = allRecords(buffRow).filter((record) => record !== buffRow && (typeof record.name === 'string' || (isRecord(record.ability) && typeof record.ability.name === 'string'))).map((record) => {
        const rawPercent = record.uptimePercent ?? record.uptime ?? record.percent ?? record.percentage
        const active = numericValue(record, ['totalUptime', 'activeTime'])
        const total = numericValue(record, ['totalTime'])
        let percent = typeof rawPercent === 'string' && rawPercent.endsWith('%') ? Number.parseFloat(rawPercent) : numericValue(record, ['uptimePercent', 'uptime', 'percent', 'percentage'])
        if (percent === null && active !== null && total !== null && total > 0) percent = active * 100 / total
        if (percent === null && active !== null && durationSeconds > 0) percent = active * 100 / analysis.fight.duration_ms
        if (percent !== null && percent > 100 && durationSeconds > 0) percent = 100 * percent / analysis.fight.duration_ms
        return { name: String((isRecord(record.ability) ? record.ability.name : undefined) ?? record.name), percent: percent === null ? null : Math.max(0, Math.min(100, percent)) }
      }).filter((ability, index, rows) => rows.findIndex((item) => item.name === ability.name) === index)
      return {
        ...actor,
        specName,
        durationSeconds,
        casts: spellUses(castsRow, actor.name),
        damage: numericValue(damageRow, ['total', 'amount', 'damage']),
        dps: numericValue(damageRow, ['dps']) ?? (numericValue(damageRow, ['total', 'amount', 'damage']) !== null && durationSeconds > 0 ? (numericValue(damageRow, ['total', 'amount', 'damage']) as number) / durationSeconds : null),
        healing: numericValue(healingRow, ['total', 'amount', 'healing']),
        hps: numericValue(healingRow, ['hps']) ?? (numericValue(healingRow, ['total', 'amount', 'healing']) !== null && durationSeconds > 0 ? (numericValue(healingRow, ['total', 'amount', 'healing']) as number) / durationSeconds : null),
        damageTaken: numericValue(takenRow, ['total', 'amount', 'damageTaken', 'damage']),
        damageTakenSources: damageTakenBreakdown(takenRow),
        friendlyDamage: typeof friendlyDamageValue === 'number' && Number.isFinite(friendlyDamageValue) ? friendlyDamageValue : null,
        friendlyDamageReliable,
        friendlyDamageAbilities: typeof analysis.tables.friendly_damage_abilities === 'object' && analysis.tables.friendly_damage_abilities !== null && Array.isArray((analysis.tables.friendly_damage_abilities as Record<string, unknown>)[String(actor.id)]) ? ((analysis.tables.friendly_damage_abilities as Record<string, unknown>)[String(actor.id)] as Array<{ name: string; amount: number; hits: number }>) : [],
        deaths: actorDeathEvents,
        interrupts: actorInterrupts,
        interruptsAvailable: eventDataAvailable(analysis.events.interrupts),
        consumables,
        gear,
        averageItemLevel: itemLevels.length ? itemLevels.reduce((sum, level) => sum + level, 0) / itemLevels.length : null,
        enchantCount,
        gemCount,
        auras,
        preparationAuras,
        uptimes,
        uptimeAverage: uptimes.length && uptimes.every((ability) => ability.percent !== null) ? uptimes.reduce((sum, ability) => sum + (ability.percent ?? 0), 0) / uptimes.length : null,
        recentPercentile,
        bestPercentile,
      }
    })
}

function displayValue(value: unknown): string {
  if (typeof value === 'number') return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 1 })
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'string') return value
  return ''
}

function labelFor(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase())
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(date)) + ' UTC'
}

function AppearanceControls() {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('logtastiq-theme') ?? localStorage.getItem('htl-theme')
    if (saved === 'hellothere') return 'logtastiq'
    return ['dark', 'light', 'catppuccin-mocha', 'tokyo-night', 'nord', 'logtastiq', 'oiler', 'freedom', 'sotabror'].includes(saved ?? '') ? saved as string : 'dark'
  })
  const [fontScale, setFontScale] = useState(() => {
    const stored = Number(localStorage.getItem('logtastiq-font-scale-v2') ?? localStorage.getItem('htl-font-scale-v2'))
    return Number.isFinite(stored) && stored >= 0.9 && stored <= 1.3 ? stored : 1.1
  })
  useEffect(() => {
    document.body.dataset.theme = theme
    document.documentElement.style.setProperty('--font-scale', String(fontScale))
    localStorage.setItem('logtastiq-theme', theme)
    localStorage.setItem('logtastiq-font-scale-v2', String(fontScale))
  }, [theme, fontScale])
  return <div className="appearance-controls" aria-label="Display settings">
    <label className="font-scale-control" title="Adjust interface text size"><span>A</span><input aria-label="Text size" type="range" min="0.9" max="1.3" step="0.05" value={fontScale} onChange={(event) => setFontScale(Number(event.target.value))} /><span className="large-a">A</span></label>
    <label className="theme-picker"><span className="sr-only">Color theme</span><select className="theme-toggle" aria-label="Color theme" value={theme} onChange={(event) => setTheme(event.target.value)}><option value="dark">Dark</option><option value="light">Light</option><option value="catppuccin-mocha">Catppuccin Mocha</option><option value="tokyo-night">Tokyo Night</option><option value="nord">Nord</option><option value="logtastiq">Logtastiq</option><option value="oiler">Oiler</option><option value="freedom">FREEDOM</option><option value="sotabror">SOTABROR</option></select></label>
  </div>
}

function Header({ connected }: { connected?: boolean }) {
  const brand = useContext(BrandContext)
  const buildDate = import.meta.env.VITE_APP_BUILD_DATE || 'local build'
  const buildDateLabel = buildDate.length >= 16 ? `${buildDate.slice(0, 10)} ${buildDate.slice(11, 16)} UTC` : buildDate
  return <header className="topbar">
    <a className="brand" href="/" aria-label={`${brand.portal_name} home`}><span className="brand-mark">{brand.logo_url ? <img className="brand-logo" src={brand.logo_url} alt="" /> : <ScrollText size={17} />}</span><span className="brand-name">{brand.portal_name}</span><span className="version" title={`Built ${buildDate}`}>BUILD / {(import.meta.env.VITE_APP_VERSION || 'local').slice(0, 7)} · {buildDateLabel}</span></a>
    <div className="topbar-tools"><AppearanceControls />
    {connected !== undefined && <div className="system-status"><span className={`status-dot ${connected ? 'online' : ''}`} /> API {connected ? 'CONNECTED' : 'OFFLINE'}</div>}
    </div>
  </header>
}

function RefreshInterval({ value, onChange, allowOff = false }: { value: number; onChange: (value: number) => void; allowOff?: boolean }) {
  return <label className="live-interval">Refresh every <select className="theme-toggle" value={value} onChange={(event) => onChange(Number(event.target.value))}>
    {allowOff && <option value={0}>Off</option>}
    {refreshIntervals.map((seconds) => <option key={seconds} value={seconds}>{seconds < 60 ? `${seconds} seconds` : `${seconds / 60} minute${seconds > 60 ? 's' : ''}`}</option>)}
  </select></label>
}

function SessionDuration({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return <label className="live-interval">Stop after <select className="theme-toggle" value={value} onChange={(event) => onChange(Number(event.target.value))}>
    {sessionDurations.map((minutes) => <option key={minutes} value={minutes}>{minutes < 60 ? `${minutes} minutes` : `${minutes / 60} hour${minutes > 60 ? 's' : ''}`}</option>)}
  </select></label>
}

function HomePage() {
  const health = useQuery({ queryKey: ['health'], queryFn: getHealth, retry: 1 })
  const [reportUrl, setReportUrl] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sourceTab, setSourceTab] = useState<'wcl' | 'upload' | 'live'>('wcl')
  const [refreshSeconds, setRefreshSeconds] = useState(60)
  const [sessionMinutes, setSessionMinutes] = useState(defaultSessionMinutes)
  const [localLog, setLocalLog] = useState<LocalLog | null>(null)
  const [localError, setLocalError] = useState('')
  const [localLoading, setLocalLoading] = useState(false)

  useEffect(() => {
    function handlePageShow(event: PageTransitionEvent) {
      // Back/forward cache restores React state without remounting the page.
      if (event.persisted) setSubmitting(false)
    }
    window.addEventListener('pageshow', handlePageShow)
    return () => window.removeEventListener('pageshow', handlePageShow)
  }, [])

  async function analyzeReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const { report_code } = await parseReportURL(reportUrl)
      window.location.assign(`/reports/${encodeURIComponent(report_code)}${sourceTab === 'live' ? `?refresh=${refreshSeconds}&until=${startLiveSession(refreshSeconds, sessionMinutes).endsAt}` : ''}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that report URL.')
    } finally {
      setSubmitting(false)
    }
  }

  return <main className="shell">
    <Header connected={health.isSuccess} />
    <section className="intro">
      <div className="eyebrow"><Activity size={14} /> WARCRAFT LOGS · FRESH</div>
      <h1>Read the raid.</h1>
      <p>A private, self-hosted workspace for understanding every pull.</p>
    </section>
    <section className="connect-panel">
      <div className="panel-heading"><div><span className="step">01</span><h2>Connect a report</h2></div><span className="ready"><Check size={14} /> READY FOR INPUT</span></div>
      <div className="source-tabs" role="tablist" aria-label="Log source"><button className={sourceTab === 'wcl' ? 'active' : ''} role="tab" aria-selected={sourceTab === 'wcl'} onClick={() => setSourceTab('wcl')}>Warcraft Logs</button><button className={sourceTab === 'upload' ? 'active' : ''} role="tab" aria-selected={sourceTab === 'upload'} onClick={() => setSourceTab('upload')}>Upload combat log</button><button className={sourceTab === 'live' ? 'active' : ''} role="tab" aria-selected={sourceTab === 'live'} onClick={() => setSourceTab('live')}>Live updates</button></div>
      {sourceTab !== 'upload' ? <>
      <form className="report-form" onSubmit={analyzeReport}>
        <label htmlFor="report-url">REPORT URL</label>
        <div className="input-row"><input id="report-url" type="url" required value={reportUrl} onChange={(event) => setReportUrl(event.target.value)} placeholder="https://fresh.warcraftlogs.com/reports/…" /><button type="submit" disabled={submitting}>{submitting ? <LoaderCircle className="spin" size={15} /> : 'ANALYZE LOG'} {!submitting && <ArrowUpRight size={15} />}</button></div>
        {sourceTab === 'live' && <div className="live-settings"><RefreshInterval value={refreshSeconds} onChange={setRefreshSeconds} /><SessionDuration value={sessionMinutes} onChange={setSessionMinutes} /><p>Check for new pulls until the selected time limit, then stop automatically. Checks pause in background tabs; time away still counts toward the limit.</p></div>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </form>
      <div className="panel-foot"><span>Paste a public Fresh report link to begin.</span><span>PRIVATE BY DESIGN</span></div></> : <>
      <form className="report-form" onSubmit={async (event) => { event.preventDefault(); const file = (event.currentTarget.elements.namedItem('combat-log') as HTMLInputElement).files?.[0]; if (!file) return; setLocalLoading(true); setLocalError(''); setLocalLog(null); try { setLocalLog(await uploadCombatLog(file)) } catch (err) { setLocalError(err instanceof Error ? err.message : 'Could not analyze this combat log.') } finally { setLocalLoading(false) } }}>
        <label htmlFor="combat-log">WOW ADVANCED COMBAT LOG (.TXT OR .LOG, UP TO 160 MB · LARGE FILES COMPRESSED)</label><div className="input-row"><input id="combat-log" name="combat-log" type="file" accept=".txt,.log,text/plain" required /><button type="submit" disabled={localLoading}>{localLoading ? <LoaderCircle className="spin" size={15} /> : 'ANALYZE FILE'} {!localLoading && <ArrowUpRight size={15} />}</button></div>{localError && <p className="form-error" role="alert">{localError}</p>}
      </form><div className="panel-foot"><span>Analysis runs locally on this server. The file is not sent to Warcraft Logs.</span><span>UPLOAD</span></div>
      </>}
    </section>
    {localLog && <LocalLogView log={localLog} />}
    {!localLog && <section className="empty-state"><div className="empty-icon"><Swords size={19} /></div><div><h3>Awaiting encounter data</h3><p>Report overview, boss progression, kills, wipes, and fight durations appear after analysis.</p></div><span className="empty-index">— / —</span></section>}
    <Footer />
  </main>
}

function LocalLogView({ log }: { log: LocalLog }) {
  const [selected, setSelected] = useState(0)
  const [wclUrl, setWclUrl] = useState('')
  const encounter = log.encounters[Math.min(selected, log.encounters.length - 1)]
  if (!encounter) return null
  const bossPlayerDebuffs = encounter.debuffs.filter((row) => row.target_is_boss && row.provider_is_player)
  const bossOtherDebuffs = encounter.debuffs.filter((row) => row.target_is_boss && !row.provider_is_player)
  const otherEnemyDebuffs = encounter.debuffs.filter((row) => !row.target_is_boss)
  const totalDamageTaken = encounter.damage_sources.reduce((total, row) => total + row.sources.reduce((sum, source) => sum + source.amount, 0), 0)
  const maximumDamage = Math.max(1, ...encounter.damage_sources.flatMap((row) => row.sources.map((source) => source.amount)))
  const formatFightTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
  return <section className="local-log-panel"><div className="card-heading"><div><h3>Combat log overview</h3><p>{log.file_name} · {log.encounter_count} boss encounters</p></div><span>{log.line_count.toLocaleString()} LINES</span></div>
    <div className="local-encounter-control"><label className="local-select-label" htmlFor="encounter-select">BOSS ENCOUNTER</label><select id="encounter-select" value={selected} onChange={(event) => setSelected(Number(event.target.value))}>{log.encounters.map((fight, index) => <option key={`${fight.id}-${index}`} value={index}>{fight.name} · {fight.kill ? 'Kill' : fight.kill === false ? 'Wipe' : 'Unknown'}</option>)}</select></div>
    <div className="local-statline"><strong>{encounter.name}</strong><span>{formatFightTime(encounter.duration_seconds)}</span><span>{encounter.kill ? 'KILL' : encounter.kill === false ? 'WIPE' : 'INCOMPLETE'}</span></div>
    <div className="local-summary-grid"><article><span>FIGHT LENGTH</span><strong>{formatFightTime(encounter.duration_seconds)}</strong><small>selected encounter</small></article><article><span>ROSTER</span><strong>{encounter.roster.length}</strong><small>players observed</small></article><article className={encounter.deaths.length ? 'local-summary-alert' : ''}><span>DEATHS</span><strong>{encounter.deaths.length}</strong><small>player deaths recorded</small></article><article><span>DAMAGE TAKEN</span><strong>{totalDamageTaken.toLocaleString()}</strong><small>logged player damage</small></article></div>
    <section className="local-analysis-section"><div className="local-section-heading"><div><span className="local-section-kicker">01 / SURVIVAL</span><h4>Critical moments</h4></div><span>{encounter.deaths.length} DEATHS</span></div>
      {encounter.deaths.length ? <><div className="local-death-track"><span className="local-track-start">0:00</span><div>{encounter.deaths.map((death, index) => <i key={`${death.player}-${index}`} style={{ left: `${Math.min(100, 100 * death.timestamp_seconds / Math.max(1, encounter.duration_seconds))}%` }} title={`${death.player} · ${formatFightTime(death.timestamp_seconds)}`} />)}</div><span>{formatFightTime(encounter.duration_seconds)}</span></div><div className="local-death-list">{encounter.deaths.map((death, index) => <article key={`${death.player}-${index}`}><time>{formatFightTime(death.timestamp_seconds)}</time><strong>{death.player}</strong>{death.last_hit ? <span>{death.last_hit.ability} · {death.last_hit.damage_type} · {death.last_hit.amount.toLocaleString()} damage <small>from {death.last_hit.source}</small></span> : <span>Final damaging event unavailable in this log slice</span>}</article>)}</div></> : <p className="analysis-empty">No player deaths were recorded during this encounter.</p>}
      <p className="data-note">Death recaps show the last logged damage event immediately before the death when available; this may not prove the single lethal blow.</p>
    </section>
    <BossReferenceCard fightName={encounter.name} durationMs={encounter.duration_seconds * 1000} casts={encounter.boss_casts} damageSources={encounter.damage_sources.flatMap((player) => player.sources)} />
    <BossCastCard fightName={encounter.name} durationMs={encounter.duration_seconds * 1000} localCasts={encounter.boss_casts} casts={null} interrupts={null} actors={[]} />
    <section className="local-analysis-section"><div className="local-section-heading"><div><span className="local-section-kicker">02 / INCOMING DAMAGE</span><h4>Damage taken · source breakdown</h4></div><span>{encounter.damage_sources.reduce((sum, row) => sum + row.sources.length, 0)} SOURCES</span></div>
      {encounter.damage_sources.length ? <div className="local-player-source-grid">{encounter.damage_sources.map((player) => <article key={player.player}><header><strong>{player.player}</strong><span>{player.sources.reduce((sum, source) => sum + source.amount, 0).toLocaleString()} total</span></header>{player.sources.slice(0, 5).map((source) => <div className="local-source-row" key={`${source.source}-${source.ability}-${source.damage_type}`}><span><b>{source.ability}</b><small>{source.source} · {source.damage_type} · {source.hits} hits</small></span><i><em style={{ width: `${Math.max(2, source.amount * 100 / maximumDamage)}%` }} /></i><strong>{source.amount.toLocaleString()}</strong></div>)}</article>)}</div> : <p className="analysis-empty">No player damage events were recorded for this encounter.</p>}
    </section>
    <section className="local-analysis-section"><div className="local-section-heading"><div><span className="local-section-kicker">03 / RAID DEBUFFS</span><h4>Short debuffs</h4></div><span>{encounter.debuffs.length} EFFECTS</span></div><p className="local-section-note">Uptime is measured against the selected boss fight. Source identity distinguishes player applications from boss, pet, and environmental sources.</p>
      <BossDebuffPriorityCard fightName={encounter.name} durationMs={encounter.duration_seconds * 1000} rows={encounter.debuffs.filter((row) => row.target_is_boss)} />
      <LocalDebuffBucket title="On the boss · applied by players" rows={bossPlayerDebuffs} duration={encounter.duration_seconds} />
      <LocalDebuffBucket title="On the boss · other sources" rows={bossOtherDebuffs} duration={encounter.duration_seconds} />
      <LocalDebuffBucket title="On other enemies" rows={otherEnemyDebuffs} duration={encounter.duration_seconds} />
    </section>
    <section className="long-buff-section local-analysis-section"><div className="local-section-heading"><div><span className="local-section-kicker">04 / PRE-PULL COVERAGE</span><h4>Long-duration class buffs</h4></div><span>{encounter.long_buffs.length} BUFF TYPES</span></div><p className="local-section-note">Missing coverage is surfaced first; expand a buff to inspect the complete roster and uptime.</p>
      {encounter.long_buffs.length ? <div className="long-buff-grid">{encounter.long_buffs.map((buff) => { const missing = buff.players.filter((player) => player.uptime_percent === 0); const covered = buff.players.length - missing.length; return <article className="long-buff-card" key={buff.ability}><header><strong>{buff.ability}</strong><span>{missing.length ? `${missing.length} missing` : `${covered} / ${buff.roster_size} covered`}</span></header><div className="buff-missing-summary">{missing.length ? <><strong>{missing.length} players not seen</strong><span>{missing.map((player) => player.name).join(', ')}</span></> : <strong>All roster members seen with this buff</strong>}</div><details><summary>Show all {buff.players.length} players and uptime</summary><div className="long-buff-players">{buff.players.map((player) => <div className={`long-buff-player ${player.uptime_percent === 0 ? 'buff-missing' : ''}`} key={player.id}><span><b>{player.name}</b><small>{player.uptime_percent === 0 ? 'Not seen in log' : player.present_before_pull ? 'Active at pull' : 'Applied during fight'}</small></span><i><em style={{ width: `${Math.min(100, player.uptime_percent)}%` }} /></i><strong>{player.uptime_percent.toFixed(0)}%</strong><small>{player.uptime_seconds}s</small></div>)}</div></details></article>})}</div> : <p className="analysis-empty">No recognized long-duration class buffs were observed on this encounter roster.</p>}
      <p className="data-note">Only buffs recorded on at least one player are listed. “Not seen” means the log contains no application or active interval for that player; verify assignments and logging coverage before treating it as a miss.</p>
    </section>
    <ObservedRaidBuffCard rows={encounter.raid_buffs} />
    <section className="local-analysis-section"><div className="local-section-heading"><div><span className="local-section-kicker">05 / ARMOR</span><h4>Estimated armor reduction</h4></div><span>ESTIMATES</span></div>{encounter.armor_reduction.length ? <div className="armor-grid">{encounter.armor_reduction.map((item) => <article key={item.ability}><span>{item.ability}</span><strong>{item.estimated_armor_reduction.toLocaleString()} armor</strong><small>{item.uptime_seconds}s applied · {item.targets} targets</small></article>)}</div> : <p className="analysis-empty">No recognized armor-reduction debuffs were recorded.</p>}</section>
    <details className="local-compare"><summary>Compare with a Warcraft Logs report</summary><form onSubmit={(event) => { event.preventDefault(); const match = wclUrl.match(/\/reports\/([A-Za-z0-9]+)/); if (match) window.open(`/reports/${match[1]}`, '_blank', 'noopener,noreferrer') }}><label htmlFor="local-wcl-url">PUBLIC FRESH REPORT URL</label><div className="input-row"><input id="local-wcl-url" type="url" value={wclUrl} onChange={(event) => setWclUrl(event.target.value)} placeholder="https://fresh.warcraftlogs.com/reports/…" required /><button type="submit">OPEN COMPARISON <ExternalLink size={14} /></button></div></form><small>Opens the WCL report analyzer in a second tab for side-by-side review.</small></details>
  </section>
}

function LocalDebuffBucket({ title, rows, duration }: { title: string; rows: LocalDebuff[]; duration: number }) {
  const groups = new Map<string, LocalDebuff[]>()
  rows.forEach((row) => groups.set(row.provider || 'Unknown source', [...(groups.get(row.provider || 'Unknown source') ?? []), row]))
  return <article className="local-debuff-bucket"><header><strong>{title}</strong><span>{rows.length} effects</span></header>{rows.length ? <div className="player-debuff-groups">{[...groups.entries()].map(([provider, effects]) => <div className="player-debuff-group" key={provider}><h5>{provider}</h5>{[...effects].sort((a, b) => b.uptime_percent - a.uptime_percent || a.ability.localeCompare(b.ability)).map((row, index) => <div className="local-debuff-row" key={`${row.spell_id}-${row.target}-${index}`}><div><strong>{row.ability}</strong><small>{row.target} · {row.applications} applications</small></div><span className="uptime-meter"><i style={{ width: `${Math.min(100, row.uptime_percent)}%` }} /></span><b>{row.uptime_percent.toFixed(1)}%</b><small>{row.uptime_seconds.toFixed(1)}s / {duration.toFixed(0)}s</small></div>)}</div>)}</div> : <p className="analysis-empty">No effects in this category were recorded.</p>}</article>
}

function ReportPage({ code }: { code: string }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState(() => readLiveSession(window.location.search))
  const [sessionMinutes, setSessionMinutes] = useState(defaultSessionMinutes)
  const [, updateClock] = useState(0)
  const live = session.endsAt > 0
  const active = isLiveSessionActive(session)
  useEffect(() => {
    const url = new URL(window.location.href)
    if (session.refreshSeconds) {
      url.searchParams.set('refresh', String(session.refreshSeconds))
      url.searchParams.set('until', String(session.endsAt))
    } else {
      url.searchParams.delete('refresh')
      url.searchParams.delete('until')
    }
    window.history.replaceState(window.history.state, '', url)
  }, [session])
  useEffect(() => {
    if (!session.refreshSeconds) return
    const checkDeadline = () => updateClock((value) => value + 1)
    const timer = window.setTimeout(checkDeadline, Math.max(0, session.endsAt - Date.now()))
    window.addEventListener('pageshow', checkDeadline)
    document.addEventListener('visibilitychange', checkDeadline)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pageshow', checkDeadline)
      document.removeEventListener('visibilitychange', checkDeadline)
    }
  }, [session])
  const reportKey = ['report', code, session.endsAt]
  const report = useQuery({
    queryKey: reportKey,
    queryFn: () => {
      // Check wall-clock time at request execution, including delayed retries/wakeups.
      if (live && !isLiveSessionActive(session)) {
        return queryClient.getQueryData<Report>(reportKey) ?? fetchReport(code)
      }
      return fetchReport(code, live)
    },
    retry: (failureCount) => failureCount < 1 && (!live || isLiveSessionActive(session)),
    placeholderData: keepPreviousData,
    refetchInterval: () => isLiveSessionActive(session) ? session.refreshSeconds * 1000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: !live,
    refetchOnReconnect: !live,
  })
  const fightsQuery = useQuery({ queryKey: ['report-fights', code], queryFn: () => fetchFights(code), enabled: report.isSuccess && !live, retry: 1 })
  const fights = live ? { ...fightsQuery, data: report.data?.fights, isLoading: report.isLoading } : fightsQuery
  const [selectedFightId, setSelectedFightId] = useState<number | null>(null)
  const [benchmarkStrictness, setBenchmarkStrictness] = useState('balanced')
  const [benchmarkSource, setBenchmarkSource] = useState('recent')
  const analysisFightId = selectedFightId ?? report.data?.fights.find((fight) => fight.encounter_id > 0)?.fight_id ?? null
  const selectedFight = report.data?.fights.find((fight) => fight.fight_id === analysisFightId)
  const analysis = useQuery({ queryKey: ['fight-analysis', code, analysisFightId, selectedFight], queryFn: () => fetchFightAnalysis(code, analysisFightId as number), enabled: analysisFightId !== null, retry: 1, refetchOnWindowFocus: !live, refetchOnReconnect: !live })
  const effectiveBenchmarkSource = analysis.data?.fight.kill === false ? 'progression' : benchmarkSource
  const benchmarks = useQuery({ queryKey: ['fight-benchmarks', code, analysisFightId, benchmarkStrictness, effectiveBenchmarkSource], queryFn: () => fetchBenchmarks(code, analysisFightId as number, benchmarkStrictness, effectiveBenchmarkSource), enabled: analysisFightId !== null, retry: 1, refetchOnWindowFocus: !live, refetchOnReconnect: !live })
  const playerStats = useMemo(() => analysis.data ? makePlayerStats(analysis.data) : [], [analysis.data])
  const encounterActors = analysis.data ? [...analysis.data.actors, ...(analysis.data.enemy_actors ?? [])] : []
  const deathEvents = analysis.data ? tableRows(analysis.data.events.deaths) : []
  const interruptEvents = analysis.data ? tableRows(analysis.data.events.interrupts) : []
  const composition = useMemo(() => {
    const counts = new Map<string, number>()
    for (const player of playerStats) counts.set(player.subType || 'Unknown class', (counts.get(player.subType || 'Unknown class') ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [playerStats])
  const metricLeaders = (key: 'damage' | 'healing' | 'damageTaken' | 'friendlyDamage') => [...playerStats].filter((player) => player[key] !== null && (key !== 'friendlyDamage' || player.friendlyDamageReliable)).sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0)).slice(0, playerStats.length)

  return <main className="shell report-shell">
    <Header connected />
    <div className="report-back"><a href="/"><ArrowLeft size={14} /> ALL REPORTS</a><a href={`https://fresh.warcraftlogs.com/reports/${encodeURIComponent(code)}`} target="_blank" rel="noreferrer">OPEN IN WARCRAFT LOGS <ExternalLink size={13} /></a></div>
    <section className="live-settings" aria-label="Report updates">
      <RefreshInterval value={active ? session.refreshSeconds : 0} onChange={(seconds) => setSession((current) => changeLiveInterval(current, seconds, sessionMinutes))} allowOff />
      {!active && <SessionDuration value={sessionMinutes} onChange={setSessionMinutes} />}
      <span role="status">{report.isFetching ? 'Checking Warcraft Logs…' : report.dataUpdatedAt ? `Last loaded ${new Date(report.dataUpdatedAt).toLocaleTimeString()}` : 'Waiting for report'}</span>
      {active && <p>Stops automatically at {new Date(session.endsAt).toLocaleTimeString()}. Background time counts toward this limit. Change to Off to stop sooner.</p>}
      {live && !active && <p role="status">Live updates stopped. Choose a refresh interval to start a new timed session.</p>}
      {report.isError && report.data && <p role="alert">Update failed. Showing the last loaded report. {active ? 'Will retry at the selected interval until the session ends.' : ''}</p>}
    </section>
    {report.isLoading && <section className="loading-panel"><LoaderCircle className="spin" size={18} /> FETCHING REPORT FROM FRESH WARCRAFT LOGS</section>}
    {report.isError && !report.data && <section className="error-panel"><CircleHelp size={18} /><div><h2>Report could not be loaded</h2><p>{report.error.message}</p><a href="/">Try another report <ArrowUpRight size={13} /></a></div></section>}
    {report.data && <>
      <section className="report-heading">
        <div className="eyebrow"><Activity size={14} /> REPORT / {report.data.code}</div>
        <h1>{report.data.title}</h1>
        <div className="report-meta"><span>{report.data.zone ?? 'Unknown zone'}</span>{report.data.guild && <><i /> <span>{report.data.guild}</span></>}<i /><span>{formatDate(report.data.start_time)}</span></div>
      </section>
      <section className="stat-grid" aria-label="Report summary">
        <Stat icon={<Clock3 size={15} />} label="RAID DURATION" value={formatDuration(report.data.duration_ms)} tint="blue" />
        <Stat icon={<Swords size={15} />} label="BOSS ENCOUNTERS" value={String(report.data.boss_count).padStart(2, '0')} tint="lavender" />
        <Stat icon={<Trophy size={15} />} label="KILLS" value={String(report.data.kill_count).padStart(2, '0')} tint="mint" />
        <Stat icon={<Skull size={15} />} label="WIPES" value={String(report.data.wipe_count).padStart(2, '0')} tint="pink" />
      </section>
      <section className="progression-section">
        <div className="section-heading"><div><span className="step">02</span><h2>Boss progression</h2></div><span>{report.data.fight_count} TOTAL FIGHTS</span></div>
        {report.data.bosses.length === 0 ? <div className="no-bosses">No boss encounters were found in this report.</div> : <div className="boss-list">
          {report.data.bosses.map((boss, index) => <article className="boss-row" key={boss.encounter_id}>
            <div className="boss-summary"><span className="boss-index">{String(index + 1).padStart(2, '0')}</span><span className="boss-mark"><Swords size={16} /></span><div className="boss-name"><h3>{boss.name}</h3><span>ENCOUNTER {boss.encounter_id} · {boss.attempts} {boss.attempts === 1 ? 'ATTEMPT' : 'ATTEMPTS'}</span></div><div className="boss-results"><span className="kill-count"><Trophy size={13} /> {boss.kills}</span><span className="wipe-count"><Skull size={13} /> {boss.wipes}</span></div><div className={`boss-state ${boss.kills ? 'boss-killed' : 'boss-open'}`}>{boss.kills ? 'DEFEATED' : 'IN PROGRESS'}</div></div>
            <div className="attempt-list">{boss.fights.map((fight, attempt) => <div className="attempt" key={fight.fight_id}>
              <span className="attempt-number">PULL {String(attempt + 1).padStart(2, '0')}</span>
              <span className={`attempt-status ${fight.kill ? 'attempt-kill' : fight.kill === false ? 'attempt-wipe' : 'attempt-unknown'}`}>{fight.kill ? 'KILL' : fight.kill === false ? 'WIPE' : 'UNKNOWN'}</span>
              <div className="attempt-track"><span className={fight.kill ? 'track-kill' : 'track-wipe'} style={{ width: `${fight.kill ? 100 : Math.max(4, Math.min(100, fight.fight_percentage ?? 4))}%` }} /></div>
              <span className="attempt-duration">{formatDuration(fight.duration_ms)}</span>
              {fight.fight_percentage !== null && fight.fight_percentage !== undefined && !fight.kill && <span className="attempt-percent">{fight.fight_percentage.toFixed(1)}%</span>}
            </div>)}</div>
          </article>)}
        </div>}
      </section>
      <section className="analysis-section">
        <div className="section-heading"><div><span className="step">03</span><h2>Encounter review</h2></div><span>PLAYER METRICS & REVIEW POINTS</span></div>
        <div className="analysis-controls"><label htmlFor="fight-select">SELECT A PULL</label><select id="fight-select" value={analysisFightId ?? ''} onChange={(event) => setSelectedFightId(Number(event.target.value))}>
          {report.data.fights.filter((fight) => fight.encounter_id > 0).map((fight, index) => <option key={fight.fight_id} value={fight.fight_id}>{fight.name} · Pull {index + 1} · {fight.kill ? 'Kill' : 'Wipe'} · {formatDuration(fight.duration_ms)}</option>)}
        </select></div>
        {analysis.isLoading && <div className="minor-loading"><LoaderCircle className="spin" size={14} /> LOADING DAMAGE, HEALING, SURVIVABILITY, INTERRUPTS & UPTIME</div>}
        {analysis.isError && <div className="inline-error">Encounter analysis unavailable: {analysis.error.message}</div>}
        {analysis.data && <>
          <div className="review-notes"><h3>Raid review</h3><p>Start with survival, dangerous moments, and raid coverage. Use damage and healing as context for what happened; they do not measure raid performance on their own.</p><small>Damage taken is a review signal, not an avoidable damage verdict. Buff expectations depend on role, assignment, encounter timing, and the composition.</small></div>
          <section className="raid-overview" aria-label="Raid review overview">
            <article className="overview-card"><span className="overview-icon tint-pink"><Skull size={17} /></span><div><strong>{eventDataAvailable(analysis.data.events.deaths) ? deathEvents.length : '—'}</strong><span>Deaths recorded</span></div><small>Review the moments before each death</small></article>
            <article className="overview-card"><span className="overview-icon tint-blue"><Shield size={17} /></span><div><strong>{eventDataAvailable(analysis.data.events.interrupts) ? interruptEvents.length : '—'}</strong><span>Interrupts landed</span></div><small>Compare with assigned casts and misses</small></article>
            <article className="overview-card composition-card"><span className="overview-icon tint-mint"><Swords size={17} /></span><div><strong>{playerStats.length}</strong><span>Raid roster</span></div><div className="comp-bars">{composition.map(([name, count]) => <span key={name} title={`${name}: ${count}`}><i style={{ width: `${100 * count / Math.max(1, playerStats.length)}%` }} />{name}<b>{count}</b></span>)}</div></article>
          </section>
          <TimelineCard deaths={deathEvents} interrupts={interruptEvents} analysis={analysis.data} />
          <BossReferenceCard fightName={analysis.data.fight.name} durationMs={analysis.data.fight.duration_ms} casts={tableRows(analysis.data.events.boss_casts).filter((row) => String(row.type ?? '').toLowerCase() === 'cast').map((row) => { const ability = eventAbilityName(row, analysis.data.abilities); const source = actorName(row, 'source', encounterActors); const priority = castPriority(analysis.data.fight.name, source, ability); return { timestamp_seconds: Math.max(0, (Number(row.timestamp) - analysis.data.fight.start_time_ms) / 1000), source, ability, status: 'completed' as const, priority: priority.priority, reason: priority.reason, cast_ms: numericValue(row, ['castTime', 'duration']) ?? 0 } })} damageSources={playerStats.flatMap((player) => player.damageTakenSources)} observedDamageAbilities={enemyDamageAbilityNames(analysis.data.tables.damage_taken, analysis.data.enemy_actors ?? [])} />
          <BossCastCard fightName={analysis.data.fight.name} durationMs={analysis.data.fight.duration_ms} startTimeMs={analysis.data.fight.start_time_ms} casts={analysis.data.events.boss_casts} interrupts={analysis.data.events.interrupts} actors={encounterActors} abilities={analysis.data.abilities} />
          <BenchmarkCard benchmarks={benchmarks.data} analysis={analysis.data} players={playerStats} isLoading={benchmarks.isLoading} error={benchmarks.error?.message} strictness={benchmarkStrictness} onStrictnessChange={setBenchmarkStrictness} source={effectiveBenchmarkSource} onSourceChange={setBenchmarkSource} />
          <LearningPlan fightName={analysis.data.fight.name} players={playerStats} deaths={deathEvents} interruptCount={interruptEvents.length} interruptsAvailable={eventDataAvailable(analysis.data.events.interrupts)} deathsAvailable={eventDataAvailable(analysis.data.events.deaths)} />
          <div className="leader-grid">
            <LeaderCard title="Damage" players={metricLeaders('damage')} metric="damage" tint="blue" />
            <LeaderCard title="Healing" players={metricLeaders('healing')} metric="healing" tint="mint" />
            <LeaderCard title="Damage taken" players={metricLeaders('damageTaken')} metric="damageTaken" tint="pink" />
            <LeaderCard title="Friendly fire dealt" players={metricLeaders('friendlyDamage')} metric="friendlyDamage" tint="lavender" />
          </div>
          <ClassRoster players={playerStats} deathsAvailable={eventDataAvailable(analysis.data.events.deaths)} interruptsAvailable={eventDataAvailable(analysis.data.events.interrupts)} friendlyDamageComplete={analysis.data.tables.friendly_damage_complete === true} />
          <LongBuffCoverageCard players={playerStats} durationMs={analysis.data.fight.duration_ms} />
          <ObservedRaidBuffCard rows={playerStats.flatMap((player) => player.uptimes.flatMap((aura) => /bloodlust|heroism|windfury totem|wrath of air|totem of wrath|moonkin aura|leader of the pack|trueshot aura|unleashed rage|ferocious inspiration|battle shout|strength of earth|grace of air/i.test(aura.name) ? [{ family: aura.name, ability: aura.name, target: player.name, provider: '', uptime_seconds: analysis.data.fight.duration_ms / 1000 * (aura.percent ?? 0) / 100, uptime_percent: aura.percent ?? 0 }] : []))} />
          <div className="analysis-grid">
            <BossDebuffApplicationsCard fightName={analysis.data.fight.name} durationMs={analysis.data.fight.duration_ms} rows={analysis.data.events.boss_debuffs} actors={analysis.data.actors} enemies={analysis.data.enemy_actors ?? []} startTimeMs={analysis.data.fight.start_time_ms} abilities={analysis.data.abilities} />
            <BossDebuffPriorityCard fightName={analysis.data.fight.name} durationMs={analysis.data.fight.duration_ms} rows={analysis.data.events.boss_debuffs} actors={analysis.data.actors} enemies={analysis.data.enemy_actors ?? []} startTimeMs={analysis.data.fight.start_time_ms} abilities={analysis.data.abilities} />
            <UptimeCard title="Fight ability uptime" sources={[{ label: 'Buff', value: analysis.data.tables.ability_uptimes }]} durationMs={analysis.data.fight.duration_ms} />
            <LeaderCard title="Damage taken · review" players={metricLeaders('damageTaken')} metric="damageTaken" tint="pink" />
          </div>
        </>}
      </section>
      <section className="fight-log">
        <div className="section-heading"><div><span className="step">04</span><h2>Other encounters</h2></div><span>{fights.data ? `${fights.data.filter((fight) => fight.encounter_id === 0).length} TRASH` : '—'}</span></div>
        {fights.isLoading && <div className="minor-loading"><LoaderCircle className="spin" size={14} /> LOADING FIGHTS</div>}
        {fights.isError && <div className="inline-error">Fight list unavailable: {fights.error.message}</div>}
        {fights.data?.some((fight) => fight.encounter_id === 0) && <details className="trash-encounters"><summary>Trash encounters · {fights.data.filter((fight) => fight.encounter_id === 0).length}</summary><div>{fights.data.filter((fight) => fight.encounter_id === 0).slice(0, 12).map((fight) => <div className="trash-row" key={fight.fight_id}><span>TRASH</span><strong>{fight.name}</strong><span>{formatDuration(fight.duration_ms)}</span></div>)}{fights.data.filter((fight) => fight.encounter_id === 0).length > 12 && <small>{fights.data.filter((fight) => fight.encounter_id === 0).length - 12} more trash entries hidden</small>}</div></details>}
      </section>
    </>}
    <Footer />
  </main>
}

function formatMetric(value: number | null): string { return value === null ? '—' : Math.round(value).toLocaleString() }

function distribution(values: number[]): { count: number; median: number; lowerQuartile: number; upperQuartile: number } | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
  return { count: sorted.length, median, lowerQuartile: sorted[Math.floor((sorted.length - 1) * 0.25)], upperQuartile: sorted[Math.floor((sorted.length - 1) * 0.75)] }
}

function versusMedian(value: number, baseline: ReturnType<typeof distribution>): string {
  if (!baseline || baseline.median <= 0) return ''
  const difference = 100 * (value - baseline.median) / baseline.median
  return ` · ${difference > 0 ? '+' : ''}${difference.toFixed(0)}% vs median`
}

function benchmarkPlayerStats(reference: BenchmarkReference): PlayerStats[] {
  const actors = reference.actors.map((actor) => ({ ...actor, specName: reference.player_specs[String(actor.id)] ?? null }))
  return makePlayerStats({ ...reference, actors, player_details: reference.player_details ?? null, rankings: { recent_parses: null, best_rankings: null } })
}

function peersForLog(player: PlayerStats, peers: PlayerStats[]): { players: PlayerStats[]; classFallback: boolean } {
  const sameClass = peers.filter((peer) => peer.subType === player.subType)
  if (!player.specName) return { players: sameClass, classFallback: false }
  const sameSpec = sameClass.filter((peer) => peer.specName === player.specName)
  if (sameSpec.length) return { players: sameSpec, classFallback: false }
  return { players: sameClass.filter((peer) => !peer.specName), classFallback: true }
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null
}

function BenchmarkCard({ benchmarks, analysis, players, isLoading, error, strictness, onStrictnessChange, source, onSourceChange }: { benchmarks?: Benchmarks; analysis?: FightAnalysis; players: PlayerStats[]; isLoading: boolean; error?: string; strictness: string; onStrictnessChange: (value: string) => void; source: string; onSourceChange: (value: string) => void }) {
  const references = benchmarks?.reference_analyses ?? []
  const referencePlayers = references.map((reference) => ({ reference, players: benchmarkPlayerStats(reference) }))
  const raidDamage = distribution(referencePlayers.map(({ players: rows, reference }) => rows.reduce((total, player) => total + (player.dps ?? 0), 0)).filter((value) => value > 0))
  const raidHealing = distribution(referencePlayers.map(({ players: rows }) => rows.reduce((total, player) => total + (player.hps ?? 0), 0)).filter((value) => value > 0))
  const raidTakenRate = distribution(referencePlayers.map(({ players: rows, reference }) => {
    const duration = reference.fight.duration_ms / 1000
    return duration > 0 ? rows.reduce((total, player) => total + (player.damageTaken ?? 0), 0) / duration : 0
  }).filter((value) => value > 0))
  const selectedRaidDps = players.reduce((total, player) => total + (player.dps ?? 0), 0)
  const selectedRaidHps = players.reduce((total, player) => total + (player.hps ?? 0), 0)
  const selectedTakenRate = analysis && analysis.fight.duration_ms > 0 ? players.reduce((total, player) => total + (player.damageTaken ?? 0), 0) / (analysis.fight.duration_ms / 1000) : 0
  const playerComparisons = players.map((player) => {
    const peerGroups = referencePlayers.map(({ reference, players: rows }) => ({ reference, ...peersForLog(player, rows) })).filter((group) => group.players.length > 0)
    const peerLogCount = peerGroups.length
    const classFallbackLogCount = peerGroups.filter((group) => group.classFallback).length
    const valuesPerLog = (select: (peer: PlayerStats) => number | null) => peerGroups.flatMap((group) => {
      const value = mean(group.players.map(select).filter((item): item is number => item !== null))
      return value === null ? [] : [value]
    })
    const dps = distribution(valuesPerLog((peer) => peer.dps))
    const hps = distribution(valuesPerLog((peer) => peer.hps))
    const damageTaken = distribution(valuesPerLog((peer) => peer.durationSeconds > 0 && peer.damageTaken !== null ? peer.damageTaken / peer.durationSeconds : null))
    const metricFindings = peerLogCount >= 3 ? [
      ...(dps && player.dps !== null && player.dps < dps.lowerQuartile ? [`DPS is below the reference lower quartile (${formatMetric(player.dps)} vs ${formatMetric(dps.lowerQuartile)}). Review cast choices, active time, and assignment context.`] : []),
      ...(hps && player.hps !== null && player.hps < hps.lowerQuartile ? [`HPS is below the reference lower quartile (${formatMetric(player.hps)} vs ${formatMetric(hps.lowerQuartile)}). Review healing assignments, casts, and encounter timing.`] : []),
    ] : []
    const referenceAbilities = new Set(peerGroups.flatMap((group) => group.players.flatMap((peer) => peer.casts.map((spell) => spell.name))))
    const castTableAvailable = tableRows(analysis?.tables.casts).length > 0
    const castFindings = [...referenceAbilities].flatMap((abilityName) => {
      const samples = peerGroups.flatMap((group) => {
        if (tableRows(group.reference.tables.casts).length === 0) return []
        const rates = group.players.flatMap((peer) => peer.durationSeconds > 0
          ? [(peer.casts.find((item) => item.name === abilityName)?.count ?? 0) / peer.durationSeconds * 60]
          : [])
        const rate = mean(rates)
        return rate === null ? [] : [rate]
      })
      const baseline = distribution(samples)
      const logs = samples.length
      const currentCasts = player.casts.find((spell) => spell.name === abilityName)?.count ?? 0
      const currentRate = player.durationSeconds > 0 && castTableAvailable ? currentCasts / player.durationSeconds * 60 : null
      return baseline && currentRate !== null && logs >= 3 && baseline.lowerQuartile > 0 && currentRate < baseline.lowerQuartile * 0.8
        ? [{ name: abilityName, current: currentRate, baseline: baseline.median, logs, missing: currentCasts === 0 }]
        : []
    }).slice(0, 3)
    const uptimeFindings = player.uptimes.flatMap((ability) => {
      if (ability.percent === null) return []
      const samples = peerGroups.flatMap((group) => {
        const percentages = group.players.flatMap((peer) => peer.uptimes
          .filter((item) => item.name === ability.name && item.percent !== null)
          .map((item) => item.percent as number))
        const percent = mean(percentages)
        return percent === null ? [] : [percent]
      })
      const baseline = distribution(samples)
      const logCount = samples.length
      return baseline && logCount >= 3 && ability.percent < baseline.lowerQuartile - 15
        ? [{ name: ability.name, current: ability.percent, baseline: baseline.median, logs: logCount }]
        : []
    })
    return { player, peerLogCount, classFallbackLogCount, dps, hps, damageTaken, uptimeFindings, metricFindings, castFindings }
  })
  const deaths = analysis && eventDataComplete(analysis.events.deaths) ? tableRows(analysis.events.deaths).length : null
  const interrupts = analysis && eventDataComplete(analysis.events.interrupts) ? tableRows(analysis.events.interrupts).length : null
  const referenceDeaths = referencePlayers.map(({ reference }) => eventDataComplete(reference.events.deaths) ? tableRows(reference.events.deaths).length : null).filter((value): value is number => value !== null)
  const referenceInterrupts = referencePlayers.map(({ reference }) => eventDataComplete(reference.events.interrupts) ? tableRows(reference.events.interrupts).length : null).filter((value): value is number => value !== null)
  const deathMedian = distribution(referenceDeaths)
  const interruptMedian = distribution(referenceInterrupts)
  const raidReviewPrompts = references.length >= 3 ? [
    ...(raidDamage && selectedRaidDps < raidDamage.lowerQuartile ? [`Raid DPS is below the lower quartile of ${raidDamage.count} matched kills. Review active damage time, target swaps, and phase assignments.`] : []),
    ...(raidHealing && selectedRaidHps < raidHealing.lowerQuartile ? [`Raid HPS is below the lower quartile of ${raidHealing.count} matched kills. Review healing coverage and cooldown assignments alongside incoming damage.`] : []),
    ...(raidTakenRate && selectedTakenRate > raidTakenRate.upperQuartile ? [`Raid damage taken is above the upper quartile of ${raidTakenRate.count} matched kills. Review the damage timeline against encounter mechanics; this comparison cannot determine avoidability.`] : []),
    ...(deaths !== null && deathMedian && deaths > deathMedian.upperQuartile ? [`This pull has more deaths than the upper quartile of ${deathMedian.count} matched kills. Review each death with its mechanic and assignment context.`] : []),
    ...(interrupts !== null && interruptMedian && interrupts < interruptMedian.lowerQuartile ? [`Fewer interrupts landed than the lower quartile of ${interruptMedian.count} matched kills. Check the dangerous cast timeline and kick assignments; landed counts alone cannot show missed opportunities.`] : []),
  ] : []
  return <article className="analysis-card benchmark-card">
    <div className="card-heading"><div><h3>Comparable raid logs</h3><p>{source === 'progression' ? 'Other attempts in this report with the same kill or wipe result.' : source === 'recent' ? 'Recent two-week parses from this roster, matched by specialization where possible.' : 'Public execution-ranked kills for this encounter and raid size.'}</p></div><div className="benchmark-controls"><label className="benchmark-filter">COHORT<select value={source} onChange={(event) => onSourceChange(event.target.value)}>{source !== 'progression' && <><option value="recent">Recent peer parses</option><option value="execution">Top execution kills</option></>}<option value="progression">Same-report attempts</option></select></label><label className="benchmark-filter">MATCHING<select value={strictness} onChange={(event) => onStrictnessChange(event.target.value)}><option value="strict">Close · ±10%</option><option value="balanced">Balanced · ±20%</option><option value="broad">Broad · any duration</option></select></label></div></div>
    {isLoading && <p className="analysis-empty">Loading public reference logs…</p>}
    {error && <p className="analysis-empty">Reference logs unavailable: {error}</p>}
    {benchmarks && <>
      <div className="benchmark-meta"><strong>{benchmarks.sample_size}</strong><span>{benchmarks.sample_size === 1 ? 'candidate log' : 'candidate logs'}</span><span className="benchmark-source">{benchmarks.source}</span></div>
      {benchmarks.candidates.length > 0 ? <div className="benchmark-list">{benchmarks.candidates.map((candidate) => { const percentile = Number(candidate.rank_percent); return <a href={candidate.url} key={`${candidate.report_code}-${candidate.fight_id}`} target="_blank" rel="noreferrer"><span><strong>{candidate.guild ?? candidate.title ?? candidate.report_code}</strong><small>{candidate.title ?? `Report ${candidate.report_code}`}{candidate.duration_seconds === null ? '' : ` · ${formatDuration(candidate.duration_seconds * 1000)}`}{candidate.fight_percentage === null || candidate.fight_percentage === undefined ? '' : ` · ${candidate.fight_percentage.toFixed(1)}% reported progress`}{candidate.composition_similarity === null ? '' : ` · ${(candidate.composition_similarity * 100).toFixed(0)}% class overlap`}{candidate.average_item_level === null ? '' : ` · ilvl ${candidate.average_item_level.toFixed(1)}`}{candidate.matched_specs?.length ? ` · surfaced by ${candidate.matched_specs.join(', ')}` : ''}</small></span><span>{candidate.rank_percent !== null && Number.isFinite(percentile) ? `${percentile.toFixed(1)}%` : 'VIEW LOG'} <ExternalLink size={12} /></span></a>})}</div> : <p className="analysis-empty">{benchmarks.status === 'unavailable' ? benchmarks.limitations[benchmarks.limitations.length - 1] : 'No reference logs met these matching criteria. Try a broader match.'}</p>}
      {references.length > 0 && <>
        <section className="benchmark-summary"><div className="card-heading"><div><h4>Raid output vs matched reference logs</h4><p>Per-second totals compared with the median of the selected cohort.</p></div><span>{references.length} LOGS</span></div><div className="benchmark-metrics"><div><span>Raid DPS</span><strong>{formatMetric(selectedRaidDps)}</strong><small>reference median {raidDamage ? formatMetric(raidDamage.median) : '—'}{raidDamage ? ` · ${raidDamage.count} logs${versusMedian(selectedRaidDps, raidDamage)}` : ''}</small></div><div><span>Raid HPS</span><strong>{formatMetric(selectedRaidHps)}</strong><small>reference median {raidHealing ? formatMetric(raidHealing.median) : '—'}{raidHealing ? ` · ${raidHealing.count} logs${versusMedian(selectedRaidHps, raidHealing)}` : ''}</small></div><div><span>Damage taken / sec</span><strong>{formatMetric(selectedTakenRate)}</strong><small>reference median {raidTakenRate ? formatMetric(raidTakenRate.median) : '—'}{raidTakenRate ? ` · ${raidTakenRate.count} logs` : ''}</small></div><div><span>Deaths</span><strong>{deaths === null ? '—' : deaths}</strong><small>reference median {deathMedian ? `${deathMedian.median.toFixed(1)} · n=${deathMedian.count}` : '—'}</small></div><div><span>Interrupts landed</span><strong>{interrupts === null ? '—' : interrupts}</strong><small>reference median {interruptMedian ? `${interruptMedian.median.toFixed(1)} · n=${interruptMedian.count}` : '—'}</small></div></div></section>
        {raidReviewPrompts.length > 0 && <aside className="benchmark-highlights"><strong>Differences to review</strong><ul>{raidReviewPrompts.map((prompt) => <li key={prompt}>{prompt}</li>)}</ul><small>Prompts appear only when at least three reference kills are available. They point to evidence for review and do not assign fault.</small></aside>}
        <details className="benchmark-player-comparison"><summary>Compare players with {players.some((player) => player.specName) ? 'matching specializations where available' : 'the same class'} across reference logs</summary><div className="analysis-table-wrap"><table><thead><tr><th>Player</th><th>Peer group</th><th>Pull DPS</th><th>Ref. median</th><th>Peer logs</th><th>Pull HPS</th><th>Ref. median</th><th>Taken/s</th><th>Ref. median</th><th>Review prompt</th></tr></thead><tbody>{playerComparisons.map(({ player, peerLogCount, classFallbackLogCount, dps, hps, damageTaken, metricFindings, uptimeFindings, castFindings }) => { const prompts = [...metricFindings, ...uptimeFindings.map((finding) => `${finding.name} uptime: ${finding.current.toFixed(0)}% vs ${finding.baseline.toFixed(0)}% reference median across ${finding.logs} logs.`), ...castFindings.map((finding) => finding.missing ? `No logged casts of ${finding.name}; matched peers averaged ${finding.baseline.toFixed(1)} casts/min across ${finding.logs} logs. Verify it was available and assigned in this pull.` : `${finding.name}: ${finding.current.toFixed(1)} casts/min vs ${finding.baseline.toFixed(1)} median across ${finding.logs} logs; confirm the spell was expected in this role and fight phase.`)]; return <tr key={player.id}><td>{player.name}</td><td>{player.specName ? `${player.subType} · ${player.specName}${classFallbackLogCount ? ` (${classFallbackLogCount} class fallback)` : ''}` : `${player.subType} · class fallback`}</td><td>{formatMetric(player.dps)}</td><td>{dps ? formatMetric(dps.median) : '—'}</td><td>{peerLogCount}</td><td>{formatMetric(player.hps)}</td><td>{hps ? formatMetric(hps.median) : '—'}</td><td>{player.damageTaken === null ? '—' : formatMetric(player.damageTaken / Math.max(.001, player.durationSeconds))}</td><td>{damageTaken ? formatMetric(damageTaken.median) : '—'}</td><td>{prompts.length ? prompts.join(' ') : peerLogCount < 3 ? `Need more ${player.specName ? 'same-specialization' : 'same-class'} reference logs` : 'No clear gap in the available fields'}</td></tr> })}</tbody></table></div><p className="benchmark-caveat">Taken damage is shown as context, not avoidability. Uses same specialization when WCL returns it, otherwise falls back to same class and labels that fallback. {source === 'recent' ? 'Recent references come from this roster’s two-week character parses.' : source === 'progression' ? 'Progression references come from the same report and match the pull’s kill/wipe result.' : 'Comparisons use execution-ranked kills.'} Cast-rate prompts only flag low use in this sample; confirm cooldown availability, role, assignments, mechanics, and kill strategy before drawing conclusions.</p></details>
      </>}
      <details className="benchmark-notes"><summary>How these logs were matched</summary><p>{benchmarks.match_basis.length ? benchmarks.match_basis.join(' · ') : 'The report is missing fields needed to select a cohort.'}</p>{benchmarks.limitations.map((limitation) => <p key={limitation}>{limitation}</p>)}</details>
    </>}
  </article>
}

function LearningPlan({ fightName, players, deaths, interruptCount, deathsAvailable, interruptsAvailable }: { fightName: string; players: PlayerStats[]; deaths: Array<Record<string, unknown>>; interruptCount: number; deathsAvailable: boolean; interruptsAvailable: boolean }) {
  const guide = bossGuideFor(fightName)
  const deathTimes = deaths.map((row) => Number(row.timestamp)).filter(Number.isFinite).sort((a, b) => a - b)
  const clusteredDeaths = deathTimes.some((time, index) => deathTimes.slice(index + 1).some((later) => later - time <= 10_000))
  const classCounts = new Map<string, number>()
  players.forEach((player) => classCounts.set(player.subType || 'Unknown', (classCounts.get(player.subType || 'Unknown') ?? 0) + 1))
  const classSummary = [...classCounts.entries()].map(([name, count]) => `${count} ${name}`).join(' · ')
  const observedBuffs = [...new Set(players.flatMap((player) => player.uptimes.map((uptime) => uptime.name)))].slice(0, 4)
  return <section className="learning-plan" aria-labelledby="learning-plan-title">
    <div className="learning-heading"><div><span className="eyebrow">TURN THE LOG INTO PRACTICE</span><h3 id="learning-plan-title">What to learn for the next pull</h3><p>Choose one team habit to review, agree on a response, then check the next attempt for the same moment.</p></div><span className="learning-count">4 REVIEW TOPICS</span></div>
    <div className="learning-grid">
      <details className="learning-card"><summary><span className="learning-number">01 / SURVIVAL</span><h4>{deathsAvailable ? `${deaths.length} deaths to review` : 'Death data unavailable'}</h4><span className="learning-expand">Read review steps</span></summary><div className="learning-content"><p>{deathsAvailable && deaths.length ? 'Use the timeline and each player recap to find the last damaging mechanic, then check whether movement, positioning, healing, or a personal defensive could change the outcome.' : 'Open the timeline on a wipe or pull with deaths. Trace the mechanic and response before deciding whether damage was avoidable.'}</p><small>{deathsAvailable && deaths.length ? (clusteredDeaths ? 'Several deaths landed within 10 seconds: review raid-wide damage and defensive coverage together.' : 'Ask each player what they saw and which response they will try next time.') : 'Damage taken alone cannot tell expected damage from a mistake.'}</small></div></details>
      <details className="learning-card"><summary><span className="learning-number">02 / BOSS MECHANICS</span><h4>{guide?.abilities[0]?.name ?? `${interruptsAvailable ? `${interruptCount} kicks recorded` : 'Boss casts to review'}`}</h4><span className="learning-expand">Read strategy prompts</span></summary><div className="learning-content"><p>{guide?.abilities.slice(0, 2).map((ability) => `${ability.name}: ${ability.summary}`).join(' ') ?? 'Use successful kicks to map who covered each cast. Compare completed casts with the encounter plan and agree primary and backup assignments.'}</p><small>Strategy notes are encounter prompts. Confirm phase, raid composition, and assignments before treating a cast as a missed response.</small></div></details>
      <details className="learning-card"><summary><span className="learning-number">03 / RAID COVERAGE</span><h4>Match buffs and utility to this roster</h4><span className="learning-expand">Read review steps</span></summary><div className="learning-content"><p>{classSummary ? `This pull had ${classSummary}. Compare the class mix and reported buff rows with the utility your strategy expects.` : 'Compare the raid composition and reported buff rows with the utility your strategy expects.'}</p><small>{observedBuffs.length ? `Reported examples: ${observedBuffs.join(', ')}. Confirm provider, target, and assignment before calling coverage low.` : 'Buff rows are not a complete list of external buffs; confirm coverage and ownership in the log.'}</small></div></details>
      <details className="learning-card"><summary><span className="learning-number">04 / POSITION & RESPONSE</span><h4>{guide?.abilities.find((ability) => ability.danger === 'position' || ability.danger === 'raid')?.name ?? 'Plan defensive coverage before danger windows'}</h4><span className="learning-expand">Read review steps</span></summary><div className="learning-content"><p>{guide?.abilities.filter((ability) => ability.danger === 'position' || ability.danger === 'raid').slice(0, 2).map((ability) => `${ability.name}: ${ability.summary}`).join(' ') || 'Mark the next high-damage phase on the timeline. Assign raid defensives and personal cooldown reminders around it, then compare casts and deaths on the next pull.'}</p><small>Use deaths and incoming damage as clues to review a strategy, not as proof of player error.</small></div></details>
    </div>
    <div className="learning-loop"><strong>Make it stick</strong><span>Pick one topic · name an owner · agree on a response · compare the same moment next pull</span></div>
  </section>
}

function LeaderCard({ title, players, metric, tint }: { title: string; players: PlayerStats[]; metric: 'damage' | 'healing' | 'damageTaken' | 'friendlyDamage'; tint: string }) {
  const max = Math.max(1, ...players.map((player) => player[metric] ?? 0))
  const row = (player: PlayerStats, index: number) => <div className="leader-row" key={player.id}><span className="leader-rank">{index + 1}</span><span className="leader-name">{player.name}<i><b style={{ width: `${Math.max(3, 100 * (player[metric] ?? 0) / max)}%` }} /></i></span><strong>{formatMetric(player[metric])}</strong></div>
  return <article className="leader-card"><h3><span className={`leader-dot tint-${tint}`} />{title}</h3>{players.length === 0 ? <p className="analysis-empty">Metric unavailable</p> : <>{players.slice(0, 5).map(row)}{players.length > 5 && <details className="leader-more"><summary>Show all {players.length} players</summary>{players.slice(5).map((player, index) => row(player, index + 5))}</details>}</>}</article>
}

function playerSuggestions(player: PlayerStats): string[] {
  const notes: string[] = []
  if (player.recentPercentile !== null && player.recentPercentile < 30) notes.push(`This pull is at the ${player.recentPercentile.toFixed(1)}th percentile against Warcraft Logs' recent parses. Review cast choices and uptime alongside the player's role, assignments, and fight timing; the percentile alone does not explain the difference.`)
  if (player.deaths.length) notes.push(`${player.deaths.length} death${player.deaths.length === 1 ? '' : 's'} recorded. Review the final damage events and defensive timing around each death.`)
  if (player.friendlyDamageReliable && (player.friendlyDamage ?? 0) > 0) {
    const ability = [...player.friendlyDamageAbilities].sort((a, b) => b.amount - a.amount)[0]
    notes.push(`Dealt ${formatMetric(player.friendlyDamage)} friendly damage${ability ? `, mostly from ${ability.name}` : ''}. Review target selection and cleave timing in encounter context.`)
  }
  const lowestUptime = [...player.uptimes].filter((ability) => ability.percent !== null).sort((a, b) => (a.percent ?? 0) - (b.percent ?? 0))[0]
  if (lowestUptime?.percent !== null && lowestUptime) notes.push(`${lowestUptime.name} uptime was ${lowestUptime.percent.toFixed(1)}% in this pull. Check whether the buff was expected for this role and assignment.`)
  if (player.interruptsAvailable && player.interrupts.length === 0) notes.push('No interrupts were recorded. Check assigned kick duties and whether an interruptible cast occurred before drawing a conclusion.')
  if (!notes.length) notes.push('No clear issue was detected in the available fields. Compare this pull with the same player’s other attempts and their assigned role.')
  return notes
}

function PlayerDetail({ player }: { player: PlayerStats }) {
  const enchantItems = player.gear.filter((item) => item.permanentEnchantName ?? item.permanentEnchant ?? item.enchantName ?? item.enchant)
  const gemItems = player.gear.flatMap((item) => Array.isArray(item.gems) ? item.gems.filter((gem) => gem !== null && gem !== 0 && gem !== '').map((gem) => ({ item, gem })) : [])
  const maxDamageSource = Math.max(1, ...player.damageTakenSources.map((source) => source.amount))
  const topDamage = player.damageTakenSources[0]
  return <details className="player-detail"><summary>Review · {player.uptimes.length ? `${player.uptimes.length} uptime rows` : 'uptime unavailable'} · prep {player.preparationAuras.length} buffs / {player.consumables.length} consumes{topDamage ? ` · top taken: ${topDamage.ability} (${formatMetric(topDamage.amount)})` : ' · damage sources unavailable'}</summary><div className="player-detail-content">
    <section><h4>Evidence to review</h4><ul className="suggestion-list">{playerSuggestions(player).map((note) => <li key={note}>{note}</li>)}</ul></section>
    <section><h4>Damage taken sources</h4>{player.damageTakenSources.length ? <div className="player-damage-sources">{player.damageTakenSources.slice(0, 5).map((source) => <div key={`${source.source}-${source.ability}-${source.damage_type}`}><span><b>{source.ability}</b><small>{source.source || 'Source not identified'}{source.damage_type ? ` · ${source.damage_type}` : ''}</small></span><i><em style={{ width: `${Math.max(2, source.amount * 100 / maxDamageSource)}%` }} /></i><strong>{formatMetric(source.amount)}</strong></div>)}</div> : <p className="analysis-empty">Warcraft Logs did not return a readable ability breakdown for damage taken.</p>}</section>
    {(player.recentPercentile !== null || player.bestPercentile !== null) && <section><h4>WCL performance context</h4><p><b>Recent parses:</b> {player.recentPercentile === null ? 'Unavailable' : `${player.recentPercentile.toFixed(1)} percentile`}</p><p><b>Best-score rankings:</b> {player.bestPercentile === null ? 'Unavailable' : `${player.bestPercentile.toFixed(1)} percentile`}</p><p>These percentiles compare this pull against Warcraft Logs rankings, not against this guild's assignments or a fully composition-matched cohort.</p></section>}
    <section><h4>Uptime by ability</h4>{player.uptimes.length ? <ul>{player.uptimes.map((ability) => <li key={ability.name}><span>{ability.name}</span><strong>{ability.percent === null ? '—' : `${ability.percent.toFixed(1)}%`}</strong></li>)}</ul> : <p className="analysis-empty">Player uptime detail not returned for this pull.</p>}</section>
    <section><h4>Itemization</h4><div className="gear-summary"><span>Average item level <b>{player.averageItemLevel === null ? '—' : player.averageItemLevel.toFixed(1)}</b></span><span>Enchants found <b>{player.enchantCount === null ? '—' : player.enchantCount}</b></span><span>Gems found <b>{player.gemCount === null ? '—' : player.gemCount}</b></span></div>
      <details><summary>Enchant details ({enchantItems.length})</summary><ul>{enchantItems.map((item, index) => <li key={index}><span>{String(item.name ?? item.itemName ?? 'Equipped item')}</span><strong>{String(item.permanentEnchantName ?? item.permanentEnchant ?? item.enchantName ?? item.enchant)}</strong></li>)}</ul></details>
      <details><summary>Gem details ({gemItems.length})</summary><ul>{gemItems.map(({ item, gem }, index) => <li key={index}><span>{String(item.name ?? item.itemName ?? 'Equipped item')}</span><strong>{isRecord(gem) ? String(gem.name ?? gem.id ?? 'Gem') : String(gem)}</strong></li>)}</ul></details>
      {player.gear.length > 0 && <details><summary>Equipped items ({player.gear.length})</summary><ul>{player.gear.map((item, index) => <li key={index}><span>{String(item.name ?? item.itemName ?? `Item ${item.id ?? ''}`)}</span><strong>{numericValue(item, ['itemLevel', 'itemlevel', 'ilevel', 'ilvl']) ?? '—'}</strong></li>)}</ul></details>}
    </section>
    <section><h4>Preparation · buffs and consumables</h4><p><b>Consumables observed:</b> {player.consumables.length ? player.consumables.join(', ') : 'No matching consumable casts or pull-start auras returned'}</p>{player.preparationAuras.length ? <ul>{player.preparationAuras.map((aura, index) => <li key={`${aura.name}-${aura.source}-${index}`}><span>{aura.name}</span><strong>{aura.selfApplied ? 'Self applied' : `By ${aura.source}`}</strong></li>)}</ul> : <p><b>Friendly-cast buffs at pull:</b> unavailable in the returned combatant snapshot</p>}<p>Buffs are taken from the player’s pull-start aura snapshot and filtered to friendly player sources. Consumables also include matching buff effects, not just cast-table rows.</p></section>
  </div></details>
}

function ClassRoster({ players, deathsAvailable, interruptsAvailable, friendlyDamageComplete }: { players: PlayerStats[]; deathsAvailable: boolean; interruptsAvailable: boolean; friendlyDamageComplete: boolean }) {
  const groups = new Map<string, PlayerStats[]>()
  for (const player of [...players].sort((a, b) => (b.dps ?? -1) - (a.dps ?? -1))) {
    const name = player.subType || 'Class unavailable'
    groups.set(name, [...(groups.get(name) ?? []), player])
  }
  return <article className="analysis-card roster-card class-roster"><div className="card-heading"><div><h3>Compare players by class</h3><p>Players in the same class share a row layout for easier pull-to-pull comparison.</p></div><span>{players.length} PLAYERS</span></div>
          {players.length === 0 ? <p className="analysis-empty">No friendly player roster was returned for this pull.</p> : Array.from(groups.entries()).map(([className, members], index) => <details className="class-group" key={className} open={index === 0}><summary><strong>{className}</strong><span>{members.length} players · sorted by DPS</span></summary><div className="analysis-table-wrap"><table><thead><tr><th>Player</th><th>DPS</th><th>WCL · recent</th><th>WCL · best</th><th>HPS</th><th>Taken</th><th>Friendly dmg</th><th>Deaths</th><th>Kicks</th><th>Buff uptime*</th><th>Avg ilvl</th><th>Enchant</th><th>Gems</th></tr></thead><tbody>{members.map((player) => <tr key={player.id}><td><strong>{player.name}</strong><PlayerDetail player={player} /></td><td>{formatMetric(player.dps)}</td><td title="Selected pull percentile against parses submitted during the recent two-week window">{player.recentPercentile === null ? '—' : `${player.recentPercentile.toFixed(1)}%`}</td><td title="Selected pull percentile against best-score rankings">{player.bestPercentile === null ? '—' : `${player.bestPercentile.toFixed(1)}%`}</td><td>{formatMetric(player.hps)}</td><td>{formatMetric(player.damageTaken)}</td><td>{friendlyDamageComplete ? formatMetric(player.friendlyDamage) : player.friendlyDamage === null ? '—' : `${formatMetric(player.friendlyDamage)}*`}</td><td>{deathsAvailable ? player.deaths.length : '—'}</td><td>{interruptsAvailable ? player.interrupts.length : '—'}</td><td>{player.uptimeAverage === null ? '—' : `${player.uptimeAverage.toFixed(1)}%`}</td><td>{player.averageItemLevel === null ? '—' : player.averageItemLevel.toFixed(1)}</td><td>{player.enchantCount === null ? '—' : player.enchantCount}</td><td>{player.gemCount === null ? '—' : player.gemCount}</td></tr>)}</tbody></table></div></details>)}
    <p className="data-note">Buff uptime is the average of abilities reported for that player; compare within the same class and assignment, not as a universal benchmark.</p>
    {!friendlyDamageComplete && <p className="data-note">* Friendly damage event data is incomplete or unavailable. A dash means the log did not provide a reliable value.</p>}
  </article>
}

function EventCard({ title, rows, unavailable, kind, fight }: { title: string; rows: Array<Record<string, unknown>>; unavailable: boolean; kind: 'death' | 'interrupt'; fight: Fight }) {
  return <article className="analysis-card event-card"><div className="card-heading"><div><h3>{title}</h3><p>Encounter event timeline</p></div><span>{unavailable ? 'UNAVAILABLE' : `${rows.length} EVENTS`}</span></div>{unavailable ? <p className="analysis-empty">The log response did not include this event data.</p> : rows.length === 0 ? <p className="analysis-empty">No {kind} events were recorded for this pull.</p> : <div className="event-list">{rows.map((row, index) => { const time = Number(row.timestamp); const relative = Number.isFinite(time) ? Math.max(0, time - fight.start_time_ms) : null; return <div className="event-row" key={`${index}-${String(row.timestamp ?? '')}`}><time>{relative === null ? '—' : formatDuration(relative)}</time><strong>{actorName(row, kind === 'death' ? 'target' : 'source')}</strong><span>{String((isRecord(row.ability) && row.ability.name) || row.abilityName || row.name || (kind === 'death' ? 'Death' : 'Interrupt'))}</span>{kind === 'death' && <small>{String((isRecord(row.killingAbility) && row.killingAbility.name) || row.killerName || '')}</small>}</div>})}</div>}</article>
}

function TimelineCard({ deaths, interrupts, analysis }: { deaths: Array<Record<string, unknown>>; interrupts: Array<Record<string, unknown>>; analysis: FightAnalysis }) {
  const fight = analysis.fight
  const events = [
    ...deaths.map((row) => ({ row, kind: 'death' as const })),
    ...interrupts.map((row) => ({ row, kind: 'interrupt' as const })),
  ].map((event) => ({ ...event, timestamp: Number(event.row.timestamp) }))
    .filter((event) => Number.isFinite(event.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp)
  const deathsAvailable = eventDataAvailable(analysis.events.deaths)
  const interruptsAvailable = eventDataAvailable(analysis.events.interrupts)
  const duration = Math.max(1, fight.duration_ms)
  return <article className="analysis-card timeline-card">
    <div className="card-heading"><div><h3>Critical moments</h3><p>Deaths and successful interrupts across this pull</p></div><span>{formatDuration(fight.duration_ms)}</span></div>
    {!deathsAvailable && !interruptsAvailable ? <p className="analysis-empty">Timeline event data was not returned for this pull.</p> : events.length === 0 ? <p className="analysis-empty">No death or interrupt events were recorded. Missed or non-interruptible casts are not represented here.</p> : <>
      <div className="timeline-axis"><span>0:00</span><span>{formatDuration(fight.duration_ms / 2)}</span><span>{formatDuration(fight.duration_ms)}</span></div>
      <div className="timeline-track" role="img" aria-label={`${deaths.length} deaths and ${interrupts.length} interrupts during the pull`}>
        {events.map(({ row, kind }, index) => {
          const timestamp = Number(row.timestamp)
          const relative = Math.max(0, timestamp - fight.start_time_ms)
          return <span className={`timeline-marker ${kind}`} key={`${kind}-${index}`} style={{ left: `${Math.min(100, 100 * relative / duration)}%` }} title={`${formatDuration(relative)} · ${kind === 'death' ? actorName(row, 'target', analysis.actors) : actorName(row, 'source', analysis.actors)}`} />
        })}
      </div>
      <div className="timeline-legend"><span><i className="death" /> Death</span><span><i className="interrupt" /> Interrupt landed</span>{!interruptsAvailable && <small>Interrupt data unavailable</small>}</div>
      <div className="moment-list">{events.map(({ row, kind }, index) => {
        const relative = Math.max(0, Number(row.timestamp) - fight.start_time_ms)
        const ability = kind === 'death' ? deathKillingAbilityName(row, analysis.abilities) : eventAbilityName(row, analysis.abilities)
        const source = kind === 'death' ? deathKillerName(row, [...analysis.actors, ...(analysis.enemy_actors ?? [])]) : actorName(row, 'target', analysis.actors)
        const actor = actorName(row, kind === 'death' ? 'target' : 'source', analysis.actors)
        const killingAbility = isRecord(row.killingAbility) ? row.killingAbility : null
        const damageType = damageSchoolLabel(row.damageType ?? row.school ?? killingAbility?.school ?? killingAbility?.schoolName)
        const amount = numericValue(row, ['amount', 'damage', 'killingBlow'])
        const eventSummary = ability ? `${ability}${damageType ? ` · ${damageType} damage` : ''}` : kind === 'death' ? 'Killing ability unavailable' : 'Interrupt landed'
        return <div className="moment-row" key={`${kind}-row-${index}`}><time>{formatDuration(relative)}</time><span className={`moment-tag ${kind}`}>{kind === 'death' ? 'DEATH' : 'KICK'}</span><strong>{actor}</strong><span>{eventSummary}</span>{kind === 'death' && <small>{source !== 'Unknown' ? `Killer: ${source}` : 'Killer unavailable'}{amount === null ? '' : ` · ${formatMetric(amount)} damage`}</small>}</div>
      })}</div>
    </>}
    <p className="data-note">Death rows use Warcraft Logs’ recorded killing ability and damage school when available. The damage taken review shows the encounter’s largest recorded abilities for each player.</p>
  </article>
}

function BossReferenceCard({ fightName, durationMs, casts, damageSources, observedDamageAbilities = [] }: { fightName: string; durationMs: number; casts: LocalBossCast[]; damageSources: LocalDamageSource[]; observedDamageAbilities?: string[] }) {
  const guide: BossGuide | undefined = bossGuideFor(fightName)
  const observedCasts = new Map<string, { count: number; stopped: number }>()
  casts.forEach((cast) => { const row = observedCasts.get(cast.ability) ?? { count: 0, stopped: 0 }; row.count += 1; if (cast.status === 'interrupted') row.stopped += 1; observedCasts.set(cast.ability, row) })
  const allObservedDamageAbilities = [...observedDamageAbilities, ...damageSources.map((row) => row.ability)]
  const incoming = new Map<string, { ability: string; amount: number; hits: number; source: string }>()
  damageSources.forEach((row) => { if (!row.ability || row.amount <= 0) return; const key = `${row.source}:${row.ability}`; const item = incoming.get(key) ?? { ability: row.ability, amount: 0, hits: 0, source: row.source }; item.amount += row.amount; item.hits += row.hits; incoming.set(key, item) })
  const incomingRows = [...incoming.entries()].map(([key, row]) => ({ key, ...row })).sort((a, b) => b.amount - a.amount).slice(0, 6)
  const maximumDamage = Math.max(1, ...incomingRows.map((row) => row.amount))
  const classicSearch = `https://www.wowhead.com/classic/search?q=${encodeURIComponent(fightName)}`
  const tbcSearch = `https://www.wowhead.com/tbc/search?q=${encodeURIComponent(fightName)}`
  return <article className="analysis-card boss-reference-card"><div className="card-heading"><div><span className="guide-kicker">ENCOUNTER FIELD GUIDE</span><h3>{fightName}</h3><p>{guide ? `${guide.era} · ${guide.raid}` : 'Classic / Burning Crusade encounter'}</p></div><span>{guide ? 'REFERENCE + LOG DATA' : 'LOG DATA'}</span></div>
    <div className="boss-guide-summary"><div><b>Encounter</b><p>{guide?.summary ?? 'Encounter reference is available from the linked database. This panel still summarizes abilities and incoming damage actually recorded for this selected pull.'}</p></div><div><b>Boss health</b><p>{guide?.health ?? 'Not reported in the uploaded combat-log encounter header.'}<small>{guide?.healthNote ?? 'Health varies by game version and raid tuning; open the matching guide/NPC record for the applicable value.'}</small></p></div></div>
    {guide?.abilities.length ? <section className="boss-guide-abilities"><h4>Key abilities and what they threaten</h4><div>{guide.abilities.map((ability) => { const matchedCasts = [...observedCasts.entries()].filter(([name]) => guideAbilityMatch(name, ability.name)); const castCount = matchedCasts.reduce((sum, [, row]) => sum + row.count, 0); const stoppedCount = matchedCasts.reduce((sum, [, row]) => sum + row.stopped, 0); const damageNames = [...new Set(allObservedDamageAbilities.filter((name) => guideAbilityMatch(name, ability.name)))]; const seen = castCount > 0 || damageNames.length > 0; return <article className={`guide-ability ${ability.danger}`} key={ability.name}><span>{ability.danger === 'tank' ? 'TANK' : ability.danger === 'raid' ? 'RAID DAMAGE' : ability.danger === 'position' ? 'POSITIONING' : 'INTERRUPT'}</span><div><b>{ability.name}</b><p>{ability.summary}</p></div><small>{castCount ? `${castCount} casts${stoppedCount ? ` · ${stoppedCount} stopped` : ''}` : seen ? 'Damage ability observed' : 'Not observed in cast or damage events'}</small></article>})}</div></section> : <section className="boss-guide-abilities"><h4>Abilities observed in this pull</h4>{observedCasts.size ? <div>{[...observedCasts.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 8).map(([ability, row]) => <article className="guide-ability raid" key={ability}><span>CASTS</span><div><b>{ability}</b><p>{row.count} recorded cast events in this encounter.</p></div><small>{row.stopped} stopped</small></article>)}</div> : <p className="analysis-empty">No enemy cast events were available for this pull.</p>}</section>}
    <section className="boss-observed-damage"><h4>Largest recorded incoming abilities</h4>{incomingRows.length ? <div>{incomingRows.map((row) => <div className="boss-observed-row" key={row.key}><span><b>{row.ability}</b><small>{row.source} · {row.hits || '—'} hits</small></span><i><em style={{ width: `${Math.max(2, 100 * row.amount / maximumDamage)}%` }} /></i><strong>{row.amount.toLocaleString()}</strong></div>)}</div> : <p className="analysis-empty">No per-ability damage-taken breakdown was available.</p>}</section>
    <footer className="boss-guide-links">{guide ? <a href={guide.source} target="_blank" rel="noreferrer">Open encounter strategy source <ExternalLink size={12} /></a> : <><a href={classicSearch} target="_blank" rel="noreferrer">Wowhead Classic lookup <ExternalLink size={12} /></a><a href={tbcSearch} target="_blank" rel="noreferrer">Wowhead TBC lookup <ExternalLink size={12} /></a></>}<small>{(durationMs / 1000).toFixed(0)}s selected fight · log observations are pull-specific; guide notes are reference material.</small></footer>
  </article>
}

const TBC_BOSS_DEBUFFS = [
  { group: 'Armor reduction', name: 'Sunder Armor', aliases: ['sunder armor'], note: 'Warrior armor reduction; stacks to five. Compare with Expose Armor because these compete for the strongest armor-reduction slot.' },
  { group: 'Armor reduction', name: 'Expose Armor', aliases: ['expose armor'], note: 'Rogue armor reduction; the improved talent rank can exceed five-stack Sunder Armor.' },
  { group: 'Armor reduction', name: 'Faerie Fire', aliases: ['faerie fire'], note: 'Druid armor reduction and, with Improved Faerie Fire, a melee/ranged hit benefit.' },
  { group: 'Armor reduction', name: 'Curse of Recklessness', aliases: ['curse of recklessness'], note: 'Warlock armor reduction; review threat and encounter context.' },
  { group: 'Spell damage amplification', name: 'Curse of the Elements', aliases: ['curse of the elements'], note: 'Increases Arcane, Fire, Frost, and Shadow damage taken.' },
  { group: 'Spell damage amplification', name: 'Misery', aliases: ['misery'], note: 'Shadow Priest debuff increasing spell damage taken.' },
  { group: 'Spell damage amplification', name: 'Shadow Weaving', aliases: ['shadow weaving'], note: 'Increases Shadow damage taken; most valuable with Shadow damage in the raid.' },
  { group: 'Physical damage amplification', name: 'Blood Frenzy', aliases: ['blood frenzy', 'trauma'], note: 'Arms Warrior physical damage taken increase.' },
  { group: 'Physical damage amplification', name: 'Expose Weakness', aliases: ['expose weakness'], note: 'Survival Hunter attack-power benefit based on the Hunter’s Agility.' },
  { group: 'School and bleed effects', name: 'Improved Scorch', aliases: ['fire vulnerability', 'improved scorch'], note: 'Fire Mage debuff increasing Fire damage taken.' },
  { group: 'School and bleed effects', name: 'Mangle', aliases: ['mangle'], note: 'Increases bleed damage; value depends on raid bleed damage.' },
  { group: 'School and bleed effects', name: 'Improved Faerie Fire', aliases: ['improved faerie fire'], note: 'Balance Druid talent adds melee/ranged hit value to Faerie Fire.' },
  { group: 'Raid sustain', name: 'Judgement of Wisdom', aliases: ['judgement of wisdom', 'judgment of wisdom'], note: 'Returns mana from attacks and spells.' },
  { group: 'Raid sustain', name: 'Judgement of Light', aliases: ['judgement of light', 'judgment of light'], note: 'Provides healing from attacks against the target.' },
]

type BossEffectRow = { name: string; provider: string; target: string; providerIsPlayer: boolean; applications: number; appliedAtSeconds: number[]; uptimePercent: number }

function bossEffectRows(value: unknown, fightName: string, durationMs: number, startTimeMs: number, players: Actor[], enemies: Actor[], abilities: NonNullable<FightAnalysis['abilities']> = []): BossEffectRow[] {
  const events = tableRows(value).filter((row) => typeof row.timestamp === 'number').sort((a, b) => Number(a.timestamp) - Number(b.timestamp))
  const playerById = new Map(players.map((actor) => [actor.id, actor]))
  const enemyById = new Map(enemies.map((actor) => [actor.id, actor]))
  const guide = bossGuideFor(fightName)
  const bossNames = [fightName, ...(guide?.aliases ?? [])].map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, ''))
  const groups = new Map<string, { name: string; provider: string; target: string; providerIsPlayer: boolean; applications: number; appliedAtSeconds: number[]; intervals: Array<[number, number]>; activeAt: number | null }>()
  for (const row of events) {
    const type = String(row.type ?? '').toLowerCase()
    if (!type.includes('debuff')) continue
    const targetId = actorId(row, 'target')
    const target = actorName(row, 'target', enemies)
    const targetActor = targetId === null ? undefined : enemyById.get(targetId)
    const normalizedTarget = (targetActor?.name ?? target).toLowerCase().replace(/[^a-z0-9]/g, '')
    if (!bossNames.some((name) => name && (normalizedTarget === name || normalizedTarget.includes(name) || name.includes(normalizedTarget)))) continue
    const sourceId = actorId(row, 'source')
    const sourceActor = sourceId === null ? undefined : playerById.get(sourceId)
    const source = sourceActor?.name ?? actorName(row, 'source', [...players, ...enemies])
    const ability = eventAbilityName(row, abilities)
    if (!ability || ability === 'Unknown ability') continue
    const key = `${sourceId ?? source}:${targetId ?? target}:${ability}`
    const entry = groups.get(key) ?? { name: ability, provider: source, target, providerIsPlayer: Boolean(sourceActor), applications: 0, appliedAtSeconds: [], intervals: [], activeAt: null }
    const time = Math.max(startTimeMs, Math.min(startTimeMs + durationMs, Number(row.timestamp)))
    if (type === 'applydebuff' || type === 'applydebuffstack' || type === 'refreshdebuff' || type === 'refreshdebuffstack') {
      entry.applications += 1
      entry.appliedAtSeconds.push((time - startTimeMs) / 1000)
      if (entry.activeAt === null) entry.activeAt = time
      else if (type.startsWith('refresh')) {
        entry.intervals.push([entry.activeAt, time])
        entry.activeAt = time
      }
    } else if (type === 'removedebuff') {
      if (entry.activeAt !== null) entry.intervals.push([entry.activeAt, time])
      entry.activeAt = null
    }
    groups.set(key, entry)
  }
  return [...groups.values()].map((entry) => {
    const intervals = entry.activeAt === null ? entry.intervals : [...entry.intervals, [entry.activeAt, startTimeMs + durationMs] as [number, number]]
    const uptimeMs = intervals.reduce((sum, [from, to]) => sum + Math.max(0, to - from), 0)
    return { name: entry.name, provider: entry.provider, target: entry.target, providerIsPlayer: entry.providerIsPlayer, applications: entry.applications, appliedAtSeconds: entry.appliedAtSeconds, uptimePercent: durationMs > 0 ? Math.min(100, uptimeMs * 100 / durationMs) : 0 }
  })
}

function BossDebuffApplicationsCard({ fightName, durationMs, startTimeMs, rows, actors, enemies, abilities = [] }: { fightName: string; durationMs: number; startTimeMs: number; rows: unknown; actors: Actor[]; enemies: Actor[]; abilities?: NonNullable<FightAnalysis['abilities']> }) {
  const effects = bossEffectRows(rows, fightName, durationMs, startTimeMs, actors, enemies, abilities)
  const playerEffects = effects.filter((row) => row.providerIsPlayer && row.applications > 0)
  const otherEffects = effects.filter((row) => !row.providerIsPlayer && row.applications > 0)
  const eventsAvailable = eventDataAvailable(rows)
  const eventsComplete = eventDataComplete(rows)
  const renderEffects = (title: string, items: BossEffectRow[]) => {
    return <section className="debuff-application-group"><h4>{title}<span>{items.length} effects</span></h4>{[...items].sort((a, b) => a.name.localeCompare(b.name) || a.provider.localeCompare(b.provider)).map((effect) => <article className="debuff-application-row" key={`${effect.name}-${effect.provider}-${effect.target}`}><div><b>{effect.name}</b><small>{effect.target} · {effect.applications} applications · {effect.uptimePercent.toFixed(1)}% uptime</small><div className="debuff-application-times" aria-label={`Application times for ${effect.name} by ${effect.provider}`}><strong>{effect.provider || 'Unknown source'}</strong>{effect.appliedAtSeconds.slice(0, 6).map((time, index) => <time key={`${time}-${index}`} title={`Applied at ${formatDuration(time * 1000)}`}>{formatDuration(time * 1000)}</time>)}{effect.appliedAtSeconds.length > 6 && <span title={effect.appliedAtSeconds.slice(6).map((time) => formatDuration(time * 1000)).join(', ')}>+{effect.appliedAtSeconds.length - 6}</span>}</div></div><i><em style={{ width: `${Math.min(100, effect.uptimePercent)}%` }} /></i></article>)}</section>
  }
  return <article className="analysis-card boss-debuff-applications"><div className="card-heading"><div><h3>Short boss debuffs</h3><p>{fightName} · applier and fight-relative application times</p></div><span>{eventsComplete ? `${playerEffects.length + otherEffects.length} EFFECTS` : 'EVENT DATA PARTIAL'}</span></div>{!eventsAvailable ? <p className="analysis-empty">Debuff application events were not returned for this pull.</p> : !playerEffects.length && !otherEffects.length ? <p className="analysis-empty">No boss debuff applications were recorded for this pull.</p> : <div className="debuff-application-columns">{playerEffects.length > 0 && renderEffects('Applied by players', playerEffects)}{otherEffects.length > 0 && renderEffects('Applied by other sources', otherEffects)}</div>}</article>
}

function BossDebuffPriorityCard({ fightName, durationMs, startTimeMs = 0, rows, actors = [], enemies = [], abilities = [] }: { fightName: string; durationMs: number; startTimeMs?: number; rows: unknown; actors?: Actor[]; enemies?: Actor[]; abilities?: NonNullable<FightAnalysis['abilities']> }) {
  const parsedRows = tableRows(rows)
  const sourceRows: BossEffectRow[] = actors.length ? bossEffectRows(rows, fightName, durationMs, startTimeMs, actors, enemies, abilities) : parsedRows.filter((row) => row.target_is_boss === true).map((row) => ({ name: String(row.ability ?? ''), provider: String(row.provider ?? ''), target: String(row.target ?? fightName), providerIsPlayer: row.provider_is_player === true, applications: Number(row.applications ?? 0), appliedAtSeconds: [], uptimePercent: Number(row.uptime_percent ?? 0) }))
  const groups = [...new Set(TBC_BOSS_DEBUFFS.map((item) => item.group))]
  const eventsComplete = actors.length ? eventDataComplete(rows) : true
  return <article className="boss-debuff-priority"><header><div><strong>High-value boss effects</strong><small>{fightName} · player applications · fight-relative uptime</small></div><span>{eventsComplete ? `${sourceRows.length} PROVIDER EFFECTS` : 'EVENT DATA PARTIAL'}</span></header>
    {groups.map((group) => <section key={group}><h5>{group}{group === 'Armor reduction' && <small> strongest applicable effect wins</small>}</h5>{TBC_BOSS_DEBUFFS.filter((rule) => rule.group === group).map((rule) => {
      const matches = sourceRows.filter((row) => {
        const name = row.name.toLowerCase()
        return rule.aliases.some((alias) => name.includes(alias))
      })
      const playerMatches = matches.filter((row) => row.providerIsPlayer)
      const percent = playerMatches.length ? Math.max(...playerMatches.map((row) => row.uptimePercent)) : null
      return <div className={`priority-debuff-row ${percent === null ? 'no-debuff-evidence' : ''}`} key={rule.name}><div><b>{rule.name}</b><small>{rule.note}</small>{playerMatches.map((row) => <small className="effect-provider" key={`${row.provider}-${row.target}`}>{row.provider} → {row.target}: {row.applications} applies · {row.uptimePercent.toFixed(1)}% uptime</small>)}{matches.some((row) => !row.providerIsPlayer) && <small>Also observed from non-player sources</small>}</div><i><em style={{ width: `${Math.min(100, percent ?? 0)}%` }} /></i><strong>{percent === null ? (eventsComplete ? 'No log evidence' : 'Unavailable') : `${percent.toFixed(1)}%`}</strong></div>
    })}</section>)}
    <p>“No log evidence” is a prompt to check roster, assignment, immunity, and phase. It does not by itself mean the raid missed an effect.</p>
  </article>
}

function castPriority(fightName: string, source: string, ability: string): { priority: 'critical' | 'high' | 'review'; reason: string } {
  const boss = fightName.toLowerCase()
  const spell = ability.toLowerCase()
  const caster = source.toLowerCase()
  if (boss.includes('magtheridon') && spell.includes('blast nova')) return { priority: 'critical', reason: 'Raid-wide damage; the cube assignment must stop this cast.' }
  if (boss.includes('magtheridon') && caster.includes('channeler') && spell.includes('shadow bolt volley')) return { priority: 'high', reason: 'Channeler volleys deal heavy raid-wide damage.' }
  if (boss.includes('magtheridon') && caster.includes('channeler') && spell.includes('dark mending')) return { priority: 'high', reason: 'A Channeler heal can extend the add phase.' }
  if (boss.includes("kael'thas") && spell.includes('fireball')) return { priority: 'critical', reason: 'Kael’thas Fireball is a dangerous tank hit; guides recommend interrupting it.' }
  if (boss.includes("kael'thas") && spell.includes('pyroblast')) return { priority: 'critical', reason: 'Review the Shock Barrier and assigned kick sequence for Pyroblast.' }
  if (boss.includes('illidari council') && caster.toLowerCase().includes('malande') && spell.includes('heal')) return { priority: 'high', reason: 'Lady Malande’s heal can undo raid damage; review interrupt coverage.' }
  return { priority: 'review', reason: 'Review this cast against the encounter plan and assigned response.' }
}

function BossCastCard({ fightName, durationMs, startTimeMs = 0, casts, interrupts, actors, abilities = [], localCasts }: {
  fightName: string
  durationMs: number
  startTimeMs?: number
  casts: unknown
  interrupts: unknown
  actors: Actor[]
  abilities?: Array<{ gameID?: number | string; id?: number | string; guid?: number | string; name: string }>
  localCasts?: LocalBossCast[]
}) {
  const normalized = localCasts
    ? localCasts.map((cast) => ({ ...cast, timeMs: cast.timestamp_seconds * 1000 }))
    : [
      ...tableRows(casts).filter((row) => String(row.type ?? '').toLowerCase() === 'cast').map((row) => {
        const ability = eventAbilityName(row, abilities)
        const source = actorName(row, 'source', actors)
        const status = String(row.type ?? '').toLowerCase().includes('fail') ? 'unknown' as const : 'completed' as const
        return { ability, source, status, timeMs: Number(row.timestamp) - startTimeMs, cast_ms: numericValue(row, ['castTime', 'duration']) ?? 0, interrupted_by: undefined, ...castPriority(fightName, source, ability) }
      }),
      ...tableRows(interrupts).map((row) => {
        const extra = isRecord(row.extraAbility) ? row.extraAbility.name : row.extraAbilityName ?? row.interruptedAbilityName
        const ability = typeof extra === 'string' ? extra : 'Interrupted cast'
        const source = actorName(row, 'target', actors)
        return { ability, source, status: 'interrupted' as const, timeMs: Number(row.timestamp) - startTimeMs, cast_ms: 0, interrupted_by: actorName(row, 'source', actors), ...castPriority(fightName, source, ability) }
      }),
    ].map((cast) => ({ ...cast, timestamp_seconds: cast.timeMs / 1000 }))
      .filter((cast) => Number.isFinite(cast.timeMs) && cast.timeMs >= 0 && cast.timeMs <= durationMs)
      .sort((a, b) => a.timeMs - b.timeMs)
  const completed = normalized.filter((cast) => cast.status === 'completed').length
  const stopped = normalized.filter((cast) => cast.status === 'interrupted').length
  const available = localCasts !== undefined || eventDataAvailable(casts) || eventDataAvailable(interrupts)
  const duration = Math.max(1, durationMs)
  return <article className={`analysis-card boss-cast-card ${localCasts ? 'local-analysis-section' : ''}`}><div className="card-heading"><div><h3>Boss cast priorities</h3><p>Enemy casts, successful stops, and encounter-specific review flags</p></div><span>{completed} CASTS · {stopped} INTERRUPTS</span></div>
    {!available ? <p className="analysis-empty">Enemy cast events were not returned for this pull.</p> : !normalized.length ? <p className="analysis-empty">No boss casts or interrupt events were recorded in the available data.</p> : <>
      <div className="boss-cast-track" role="img" aria-label={`${completed} boss casts and ${stopped} interrupts over ${formatDuration(durationMs)}`}><span>0:00</span><div>{normalized.slice(0, 250).map((cast, index) => <i key={`${cast.ability}-${index}`} className={`${cast.status} ${cast.priority}`} style={{ left: `${Math.min(100, cast.timeMs * 100 / duration)}%` }} title={`${formatDuration(cast.timeMs)} · ${cast.ability} · ${cast.status}`} />)}</div><span>{formatDuration(durationMs)}</span></div>
      <div className="boss-cast-legend"><span><i className="critical" /> Critical</span><span><i className="high" /> High</span><span><i className="review" /> Other cast</span><span><i className="interrupted" /> Interrupted</span></div>
      <div className="boss-cast-list">{normalized.map((cast, index) => <div className={`boss-cast-row ${cast.priority}`} key={`${cast.ability}-${cast.timeMs}-${index}`}><time>{formatDuration(cast.timeMs)}</time><b>{cast.ability}</b><span>{cast.source}</span><em className={cast.status}>{cast.status === 'completed' ? 'CAST COMPLETED' : cast.status === 'interrupted' ? `STOPPED${cast.interrupted_by ? ` · ${cast.interrupted_by}` : ''}` : 'OUTCOME UNKNOWN'}</em><small>{cast.reason}</small></div>)}</div>
    </>}
    <p className="data-note">Critical flags are a small, encounter-specific guide set—not a complete tactics script. Completed casts are observations, not proof that a player failed an assignment; phase and encounter strategy still matter.</p>
  </article>
}

function tableTotalTime(value: unknown, depth = 0): number | null {
  const parsed = parseJSON(value)
  if (depth > 7 || !isRecord(parsed)) return null
  const totalTime = numericValue(parsed, ['totalTime'])
  if (totalTime !== null) return totalTime
  for (const key of ['data', 'table']) {
    if (parsed[key] !== undefined) {
      const nested = tableTotalTime(parsed[key], depth + 1)
      if (nested !== null) return nested
    }
  }
  return null
}

const LONG_RAID_BUFFS = [
  { name: 'Arcane Intellect', aliases: ['arcane intellect', 'arcane brilliance'] },
  { name: 'Power Word: Fortitude', aliases: ['power word: fortitude', 'prayer of fortitude'] },
  { name: 'Mark of the Wild', aliases: ['mark of the wild', 'gift of the wild'] },
  { name: 'Blessing of Kings', aliases: ['blessing of kings', 'greater blessing of kings'] },
  { name: 'Blessing of Might', aliases: ['blessing of might', 'greater blessing of might'] },
  { name: 'Blessing of Wisdom', aliases: ['blessing of wisdom', 'greater blessing of wisdom'] },
  { name: 'Blessing of Salvation', aliases: ['blessing of salvation', 'greater blessing of salvation'] },
  { name: 'Blessing of Sanctuary', aliases: ['blessing of sanctuary', 'greater blessing of sanctuary'] },
  { name: 'Divine Spirit', aliases: ['divine spirit', 'prayer of spirit'] },
  { name: 'Shadow Protection', aliases: ['shadow protection', 'prayer of shadow protection'] },
]

function LongBuffCoverageCard({ players, durationMs }: { players: PlayerStats[]; durationMs: number }) {
  const families = LONG_RAID_BUFFS.flatMap((family) => {
    const coverage = players.map((player) => {
      const uptime = player.uptimes.filter((aura) => family.aliases.some((alias) => aura.name.toLowerCase().includes(alias)))
        .sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1))[0]
      const presentAtPull = player.auras.some((name) => family.aliases.some((alias) => name.toLowerCase().includes(alias)))
      return { player, uptime, presentAtPull }
    })
    return coverage.some((item) => item.uptime || item.presentAtPull) ? [{ family, coverage }] : []
  })
  return <article className="analysis-card long-buff-coverage"><div className="card-heading"><div><h3>Long-duration class buffs</h3><p>Missing coverage first · full uptime across this fight ({(durationMs / 1000).toFixed(0)}s)</p></div><span>{families.length} BUFF TYPES</span></div>
    {!families.length ? <p className="analysis-empty">No recognized long-duration class buffs were returned for this pull.</p> : <div className="long-buff-grid">{families.map(({ family, coverage }) => { const missing = coverage.filter(({ uptime, presentAtPull }) => !((uptime?.percent ?? 0) > 0 || presentAtPull)); const covered = coverage.length - missing.length; return <section className="long-buff-card" key={family.name}><header><strong>{family.name}</strong><span>{missing.length ? `${missing.length} missing` : `${covered} / ${coverage.length} covered`}</span></header><div className="buff-missing-summary">{missing.length ? <><strong>{missing.length} players not seen</strong><span>{missing.map(({ player }) => player.name).join(', ')}</span></> : <strong>All roster members seen with this buff</strong>}</div><details><summary>Show all {coverage.length} players and uptime</summary><div className="long-buff-players">{coverage.map(({ player, uptime, presentAtPull }) => { const percent = uptime?.percent; const seen = (percent ?? 0) > 0 || presentAtPull; const activeSeconds = percent === null || percent === undefined ? null : durationMs / 1000 * percent / 100; return <div className={`long-buff-player ${seen ? '' : 'buff-missing'}`} key={player.id}><span><b>{player.name}</b><small>{seen ? presentAtPull ? 'Active at pull' : 'Uptime recorded' : 'Not seen in log'}</small></span><i><em style={{ width: `${Math.min(100, percent ?? 0)}%` }} /></i><strong>{percent === null || percent === undefined ? presentAtPull ? 'At pull' : '—' : `${percent.toFixed(0)}%`}</strong><small>{activeSeconds === null ? 'time n/a' : `${activeSeconds.toFixed(0)}s`}</small></div>})}</div></details></section>})}</div>}
    <p className="data-note">“Not seen” means no matching uptime or pull-start aura was returned for this player. Confirm class, assignment, and logging coverage before treating it as a missed buff.</p>
  </article>
}

function ObservedRaidBuffCard({ rows }: { rows: Array<{ family: string; ability: string; target: string; provider: string; uptime_seconds: number; uptime_percent: number }> }) {
  const grouped = new Map<string, typeof rows>()
  rows.forEach((row) => grouped.set(row.family, [...(grouped.get(row.family) ?? []), row]))
  return <article className="analysis-card observed-raid-buffs"><div className="card-heading"><div><h3>In-fight and party buffs</h3><p>Observed recipients and fight-relative uptime · no roster-wide missing checks</p></div><span>{grouped.size} EFFECTS</span></div>
    {!rows.length ? <p className="analysis-empty">No tracked in-fight or party buffs were observed.</p> : <div className="observed-buff-grid">{[...grouped.entries()].map(([family, effects]) => <section key={family}><header><strong>{family}</strong><span>{new Set(effects.map((row) => row.target)).size} recipients</span></header>{effects.slice().sort((a, b) => b.uptime_percent - a.uptime_percent).slice(0, 8).map((row, index) => <div className="observed-buff-row" key={`${row.target}-${index}`}><span>{row.target}</span><i><em style={{ width: `${Math.min(100, row.uptime_percent)}%` }} /></i><b>{row.uptime_percent.toFixed(0)}%</b><small>{row.uptime_seconds.toFixed(0)}s</small></div>)}</section>)}</div>}
    <p className="data-note">Totems, party auras, and cooldown buffs depend on group placement and assignments. This view reports recipients present in the log; it does not infer who should have received them.</p>
  </article>
}

function UptimeCard({ title, sources, durationMs }: { title: string; sources: Array<{ label: string; value: unknown }>; durationMs: number }) {
  const rows = sources.flatMap(({ label, value }) => {
    const totalTime = tableTotalTime(value) ?? durationMs
    return tableRows(value).map((row) => {
      const raw = row.uptimePercent ?? row.uptime ?? row.percent ?? row.percentage
      let percent = typeof raw === 'string' && raw.endsWith('%') ? Number.parseFloat(raw) : numericValue(row, ['uptimePercent', 'uptime', 'percent', 'percentage'])
      const totalUptime = numericValue(row, ['totalUptime'])
      if (percent === null && totalUptime !== null && totalTime > 0) percent = 100 * totalUptime / totalTime
      if (percent !== null && percent > 100) percent = null
      const ability = isRecord(row.ability) ? String(row.ability.name ?? row.name ?? 'Unknown ability') : String(row.name ?? 'Unknown ability')
      const source = typeof row.sourceName === 'string' ? row.sourceName : isRecord(row.source) && typeof row.source.name === 'string' ? row.source.name : null
      const armorPerApplication = /sunder armor/i.test(ability) ? 520 : /expose armor/i.test(ability) ? 3075 : /faerie fire/i.test(ability) ? 610 : /curse of recklessness/i.test(ability) ? 800 : 0
      const stacks = /sunder armor/i.test(ability) ? Number(row.stacks ?? row.stackCount ?? 5) : 1
      const applications = numericValue(row, ['totalUses', 'applications', 'uses'])
      const fightSeconds = durationMs / 1000
      const activeSeconds = percent === null ? null : fightSeconds * percent / 100
      return { row, ability, source, percent, label, applications, fightSeconds, activeSeconds, armorEstimate: armorPerApplication * (Number.isFinite(stacks) ? Math.max(1, stacks) : 1), armorEstimateNote: /sunder armor/i.test(ability) && row.stacks === undefined && row.stackCount === undefined ? ' (5 stacks assumed)' : '' }
    })
  }).filter((row) => row.ability !== 'Unknown ability' || row.percent !== null)
  const labels = [...new Set(sources.map((source) => source.label))]
  const ordered = labels.flatMap((label) => [...rows.filter((row) => row.label === label)].sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1)).slice(0, 10))
  return <article className="analysis-card uptime-card"><div className="card-heading"><div><h3>{title}</h3><p>Reported aura presence in this pull</p></div><span>{rows.length ? `${rows.length} ROWS` : 'NO DATA'}</span></div>
    {!ordered.length ? <p className="analysis-empty">No readable uptime rows were returned for this pull.</p> : <div className="uptime-list">{ordered.map((item, index) => <div className="uptime-row" key={`${item.label}-${item.ability}-${index}`}><div><strong>{item.ability}</strong><small>{item.source ? `${item.label} · provided by ${item.source}` : `${item.label} · provider not identified`}{item.activeSeconds === null ? '' : ` · ${item.activeSeconds.toFixed(0)}s / ${item.fightSeconds.toFixed(0)}s`}{item.applications === null ? '' : ` · ${item.applications} applications`}{item.label === 'Debuff' && item.armorEstimate > 0 ? ` · ~${item.armorEstimate.toLocaleString()} armor` : ''}</small></div><span className="uptime-meter"><i style={{ width: `${Math.max(0, Math.min(100, item.percent ?? 0))}%` }} /></span><b>{item.percent === null ? '—' : `${item.percent.toFixed(1)}%`}</b></div>)}</div>}
    <p className="data-note">Percentages use Warcraft Logs total uptime over the reported table time. Debuff uptime shows time present on logged targets; multiple targets can contribute to an ability total. Armor reduction is an estimate based on TBC spell rank (five Sunder Armor stacks assumed when unavailable), not a directly measured boss armor value.</p>
  </article>
}

function AnalysisTable({ title, value }: { title: string; value: unknown }) {
  const rows = tableRows(value)
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))]
  const columns = keys.filter((key) => rows.some((row) => ['string', 'number', 'boolean'].includes(typeof row[key])))
  const priority = ['name', 'type', 'total', 'dps', 'hps', 'uptime', 'activeTime', 'count', 'deaths', 'id']
  columns.sort((a, b) => (priority.indexOf(a) < 0 ? 100 : priority.indexOf(a)) - (priority.indexOf(b) < 0 ? 100 : priority.indexOf(b)))
  const hasDetails = rows.some((row) => Object.values(row).some((field) => field !== null && typeof field === 'object'))
  return <article className="analysis-card"><h3>{title}</h3>{rows.length === 0 ? <p className="analysis-empty">No rows returned for this pull.</p> : <div className="analysis-table-wrap"><table><thead><tr>{columns.slice(0, 7).map((column) => <th key={column}>{labelFor(column)}</th>)}{hasDetails && <th>Breakdown</th>}</tr></thead><tbody>{rows.slice(0, 30).map((row, index) => <tr key={`${String(row.id ?? row.name ?? title)}-${index}`}>{columns.slice(0, 7).map((column) => <td key={column}>{displayValue(row[column])}</td>)}{hasDetails && <td>{Object.values(row).some((field) => field !== null && typeof field === 'object') && <details><summary>View</summary><pre>{JSON.stringify(Object.fromEntries(Object.entries(row).filter(([, field]) => field !== null && typeof field === 'object')), null, 2)}</pre></details>}</td>}</tr>)}</tbody></table></div>}</article>
}

function Stat({ icon, label, value, tint }: { icon: ReactNode; label: string; value: string; tint: string }) {
  return <article className="stat-card"><span className={`stat-icon tint-${tint}`}>{icon}</span><span className="stat-label">{label}</span><strong>{value}</strong></article>
}

function Footer() {
  const brand = useContext(BrandContext)
  return <footer><span>{brand.portal_name.toUpperCase()} <span className="muted">· {brand.tagline}</span></span><span>WARCRAFT LOGS CREDENTIALS STAY SERVER-SIDE</span></footer>
}

export default function App() {
  const config = useQuery({ queryKey: ['public-config'], queryFn: fetchPublicConfig, staleTime: Infinity, retry: 1 })
  const brand = config.data?.brand ?? defaultBrand
  useEffect(() => {
    document.documentElement.style.setProperty('--brand-primary', brand.primary_color)
    document.documentElement.style.setProperty('--brand-accent', brand.accent_color)
  }, [brand.primary_color, brand.accent_color])
  const match = window.location.pathname.match(/^\/reports\/([A-Za-z0-9]+)\/?$/)
  return <BrandContext.Provider value={brand}>{match ? <ReportPage code={match[1]} /> : <HomePage />}</BrandContext.Provider>
}

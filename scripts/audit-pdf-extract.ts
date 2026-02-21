import { PDFParse } from "pdf-parse"
import {
  dedupeFindings,
  type ExtractedFinding,
  parseFindingsFromPageText,
} from "./audit-pdf-extract-lib"

/** A public audit report source — one GitHub repo containing PDF audit reports. */
export interface AuditSource {
  /** Human-readable name of the audit firm */
  name: string
  /** Raw GitHub base URL for downloading PDFs */
  repoRawBase: string
  /** Repository URL (for metadata) */
  repoUrl: string
  /** List of PDF filenames to download from the repo root */
  pdfFiles: string[]
}

const DEFAULT_SOURCES: AuditSource[] = [
  {
    name: "BailSec",
    repoRawBase: "https://raw.githubusercontent.com/bailsec/BailSec/main",
    repoUrl: "https://github.com/bailsec/BailSec",
    pdfFiles: [
      "Bailsec - 0x - CrossChainReceiver - Final Report.pdf",
      "Bailsec - 0x - SafeGuard - Final Report.pdf",
      "Bailsec - 1inch - Fee Protocol - Final Report.pdf",
      "Bailsec -  Algebra.Finance - SwapX - Fee Plugin - Final Report .pdf",
      "Bailsec - Algebra - Fee Architecture Update (differential) - Final Report.pdf",
      "Bailsec - Algebra Core Update Audit (differential) - Final Report.pdf",
      "Bailsec - Algebra Factory - Update Audit (differential) - Final Report.pdf",
      "Bailsec - Algebra Integral - Update Audit (differential) Final Report Github (+Resolution).pdf",
      "Bailsec - Amphor FINAL Report Github(+resolution)(+addition).pdf",
      "Bailsec - Atlantis - Final Report.pdf",
      "Bailsec - Cairo Finance Vaults Final Report Github(+Resolution).pdf",
      "Bailsec - Camelot - Grail - Final Report.pdf",
      "Bailsec - Camelot - Grail -Final Report.pdf",
      "Bailsec - Defi Money Fee Module - Final Report.pdf",
      "Bailsec - Euler - ERC20BurnableMintable - Final Report.pdf",
      "Bailsec - Euler.Finance - EUL ERC20 - Final Report.pdf",
      "Bailsec - Five Pillar - Final Report.pdf",
      "Bailsec - GU - Final Report.pdf",
      "Bailsec - Gamma - UniswapV4 Integrations - Final Report.pdf",
      "Bailsec - Gamma - Vaults - Final Report.pdf",
      "Bailsec - Hyperdrive - LST - Final Report.pdf",
      "Bailsec - Hyperdrive - Tokenization - Final Report.pdf",
      "Bailsec - Hypertrade - V3 Core - Final Report.pdf",
      "Bailsec - ICHI - Vaults - Final Report.pdf",
      "Bailsec - Impermax - V3 Core - Final Report.pdf",
      "Bailsec - InceptionLRT - Vaults - Final Report.pdf",
      "Bailsec - Kernel - Final Report.pdf",
      "Bailsec - Kernel Dao - Distributor - Final Report.pdf",
      "Bailsec - LFJ - Final Report.pdf",
      "Bailsec - Liquify - Final Report.pdf",
      "Bailsec - Lista DAO - Lista Lending - Final Report.pdf",
      "Bailsec - Lista DAO - Lista Lending - Update - Final Report.pdf",
      "Bailsec - Lista Dao - USDT Distributor - Final Report.pdf",
      "Bailsec - Lista Dao - slisBNB Provider - Final Report.pdf",
      "Bailsec - ListaDAO - Smart Collateral + Liquidators Extension - Final Report.pdf",
      "Bailsec - MEV-X - Plugin - Final Report.pdf",
      "Bailsec - Meuna - Final Report.pdf",
      "Bailsec - Mira - ERC20 Token - Final Report.pdf",
      "Bailsec - Mira Network - Final Report.pdf",
      "Bailsec - Moebius Finance - Final Report.pdf",
      "Bailsec - Nome - Final Report.pdf",
      "Bailsec - OnlyCocksCrypto Full Report Github(+3 Resolutions).pdf",
      "Bailsec - Parallel Bridge - BridgeableToken - Final Report.pdf",
      "Bailsec - Parallel Protocol - PRL Token - Final Report.pdf",
      "Bailsec - Parallel Protocol - V3 Core - Final Report.pdf",
      "Bailsec - Ponzio The Cat Final Report.pdf",
      "Bailsec - Prom - ERC20Classic - Final Report.pdf",
      "Bailsec - Redacted - Audit.pdf",
      "Bailsec - Robinos - Final Report.pdf",
      "Bailsec - SmarDex - P2P Lending - Final Report.pdf",
      "Bailsec - Smardex - Router - Final Report.pdf",
      "Bailsec - Smardex Ecosystem - Final Report.pdf",
      "Bailsec - Smardex USDN - Final Report.pdf",
      "Bailsec - Stader Labs MaticX - Final Report.pdf",
      "Bailsec - Stader Labs bnbX - Final Report.pdf",
      "Bailsec - Stryke : MarginZero - CLAMM Options - Final Report.pdf",
      "Bailsec - SwapX  Exchange - Final Report.pdf",
      "Bailsec - SwapX - Staking Airdrop Vesting - Final Report.pdf",
      "Bailsec - Symbiotic - RewardsV2 - Final Report.pdf",
      "Bailsec - Telos OFTV1.2 - Update (differential) (+Resolution) Final Report Github.pdf",
      "Bailsec - Terminal Finance - DEX - Final Report.pdf",
      "Bailsec - TrustSwap LockToken - Update - Final Audit Report Github(+Resolution).pdf",
      "Bailsec - Trustswap LockNFT - Priceestimator (+Resolution) Final Report Github.pdf",
      "Bailsec - Trustswap LockToken (+Resolution) Final Audit Report Github.pdf",
      "Bailsec - Trustswap Multisender Final Report Github(+Resolution).pdf",
      "Bailsec - Trustswap StakingPool Audit(+Resolution)+Extension.pdf",
      "Bailsec - Trustswap StakingPool Final Report Github(+Resolution).pdf",
      "Bailsec - Trustswap SwapToken Final Audit Report Github(+2 Resolution).pdf",
      "Bailsec - Trustswap SwapToken Final Audit Report Github(+Resolution).pdf",
      "Bailsec - Trustswap Vesting (+Resolution) Final Audit Report Github.pdf",
      "Bailsec - Usual.Money Final Report(+Post Audit Review).pdf",
      "Bailsec - XTrade Update Audit (differential) - Final Report.pdf",
      "Bailsec - defi money - LeverageZap - Final Report.pdf",
      "Bailsec - defi.money - BoostedStaker - Final Report.pdf",
      "Bailsec - defi.money ChainlinkEMA - Final Report.pdf",
      "Bailsec - zkSwap Final Report Github (+Resolution).pdf",
      "BailSec - Rocketpool - Saturn - Final Report.pdf",
      "Bailsec - 1inch - CrossChainResolver - NON DISCLOSED.pdf",
      "CVE Token Final Report Github.pdf",
      "Cairo Final Report Github.pdf",
      "DegenWin Final Report Github.pdf",
      "Kuma Protocol Final Report Github.pdf",
      "OverHere Final Report Github.pdf",
      "Pharao FarmPoT - Github.pdf",
      "Prestige Club Forensic Blockchain Tracement Github.pdf",
    ],
  },
]

const TEMP_DIR = "scripts/.tmp-audit-pdfs"
const OUTPUT_DIR = "scripts/audit-pdf-output"
const CATEGORY_DIR = `${OUTPUT_DIR}/by-category`

interface DownloadResult {
  sourcePdf: string
  localPath: string
  sourceUrl: string
}

interface ExtractionMetadata {
  extraction_date: string
  sources: Array<{ name: string; repository: string }>
  attempted_pdfs: number
  processed_pdfs: number
  skipped_pdfs: number
  total_findings: number
  unique_categories: number
  source_pdfs: Array<{ name: string; url: string; source_name: string }>
  errors: Array<{ source_pdf: string; source_name: string; reason: string }>
}

function toRawGithubUrl(source: AuditSource, fileName: string): string {
  return `${source.repoRawBase}/${encodeURIComponent(fileName)}`
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._()-]+/g, "-")
}

function categoryToFileName(category: string): string {
  return category
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
}

async function ensureDirectories(): Promise<void> {
  await Bun.$`mkdir -p ${TEMP_DIR} ${CATEGORY_DIR}`.quiet()
}

async function downloadPdfWithRetry(source: AuditSource, pdfFile: string): Promise<DownloadResult> {
  const sourceUrl = toRawGithubUrl(source, pdfFile)
  let lastError: string | null = null

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(sourceUrl)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const bytes = await response.arrayBuffer()
      const localPath = `${TEMP_DIR}/${sanitizeFileName(pdfFile)}`
      await Bun.write(localPath, bytes)

      return { sourcePdf: pdfFile, sourceUrl, localPath }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      if (attempt < 2) {
        await Bun.sleep(600)
      }
    }
  }

  throw new Error(lastError ?? "unknown download error")
}

async function extractFindingsFromPdf(downloaded: DownloadResult): Promise<ExtractedFinding[]> {
  const fileData = await Bun.file(downloaded.localPath).arrayBuffer()
  const parser = new PDFParse({ data: Buffer.from(fileData) })

  try {
    const parsed = await parser.getText()
    if (!parsed.text || parsed.text.trim().length === 0 || parsed.pages.length === 0) {
      return []
    }

    const findings: ExtractedFinding[] = []

    for (const page of parsed.pages) {
      const pageFindings = parseFindingsFromPageText(page.text, downloaded.sourcePdf, page.num)
      findings.push(...pageFindings)
    }

    return dedupeFindings(findings)
  } finally {
    await parser.destroy()
  }
}

async function writeOutput(
  allFindings: ExtractedFinding[],
  metadata: ExtractionMetadata,
): Promise<void> {
  await Bun.write(`${OUTPUT_DIR}/findings.json`, JSON.stringify(allFindings, null, 2))
  await Bun.write(`${OUTPUT_DIR}/metadata.json`, JSON.stringify(metadata, null, 2))

  const byCategory = new Map<string, ExtractedFinding[]>()
  for (const finding of allFindings) {
    const bucket = byCategory.get(finding.category) ?? []
    bucket.push(finding)
    byCategory.set(finding.category, bucket)
  }

  for (const [category, findings] of byCategory.entries()) {
    const fileName = categoryToFileName(category)
    await Bun.write(`${CATEGORY_DIR}/${fileName}.json`, JSON.stringify(findings, null, 2))
  }
}

async function main(): Promise<void> {
  const sources = DEFAULT_SOURCES
  await ensureDirectories()

  const collectedFindings: ExtractedFinding[] = []
  const errors: Array<{ source_pdf: string; source_name: string; reason: string }> = []
  const sourcePdfs: Array<{ name: string; url: string; source_name: string }> = []
  let processed = 0
  let skipped = 0

  for (const source of sources) {
    console.log(`\nProcessing source: ${source.name} (${source.pdfFiles.length} PDFs)`)

    for (const pdfFile of source.pdfFiles) {
      const sourceUrl = toRawGithubUrl(source, pdfFile)
      sourcePdfs.push({ name: pdfFile, url: sourceUrl, source_name: source.name })

      try {
        const downloaded = await downloadPdfWithRetry(source, pdfFile)
        const findings = await extractFindingsFromPdf(downloaded)

        if (findings.length === 0) {
          skipped += 1
          errors.push({
            source_pdf: pdfFile,
            source_name: source.name,
            reason: "No extractable finding text detected",
          })
          continue
        }

        processed += 1
        collectedFindings.push(...findings)
        console.log(`  processed ${pdfFile}: ${findings.length} findings`)
      } catch (error) {
        skipped += 1
        const reason = error instanceof Error ? error.message : String(error)
        errors.push({ source_pdf: pdfFile, source_name: source.name, reason })
        console.warn(`  skipped ${pdfFile}: ${reason}`)
      }
    }
  }

  const allFindings = dedupeFindings(collectedFindings)
  const uniqueCategoryCount = new Set(allFindings.map((finding) => finding.category)).size

  const metadata: ExtractionMetadata = {
    extraction_date: new Date().toISOString(),
    sources: sources.map((s) => ({ name: s.name, repository: s.repoUrl })),
    attempted_pdfs: sources.reduce((sum, s) => sum + s.pdfFiles.length, 0),
    processed_pdfs: processed,
    skipped_pdfs: skipped,
    total_findings: allFindings.length,
    unique_categories: uniqueCategoryCount,
    source_pdfs: sourcePdfs,
    errors,
  }

  await writeOutput(allFindings, metadata)

  console.log(
    `done: ${allFindings.length} unique findings across ${uniqueCategoryCount} categories`,
  )
  if (allFindings.length < 10) {
    console.warn("warning: fewer than 10 findings extracted")
  }
}

await main()

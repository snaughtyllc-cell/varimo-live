"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useGallery } from "@/lib/useGallery";
import { useRun } from "@/lib/runStore";
import {
  filterSources,
  sortSources,
  avgOriginalityPct,
  filesReadyCount,
  parseGalleryVariantQuery,
  gallerySearchPath,
  pushGallerySearch,
} from "@/lib/gallery";
import {
  okVariantKeys,
  okVariantRefs,
  selectAllLabel,
  selectionHasAllOk,
  sendDisabledReason,
  withOkSelection,
} from "@/lib/drive";
import {
  fillFileCache,
  filesReadyNow,
  phoneShareHintCopy,
  saveNoneSelectedCopy,
  saveOrShareVideoFiles,
  selectedShareableVariants,
  shareEmptyCopy,
  shareLoadingCopy,
  shareOutcomeMessage,
  shareRetryCopy,
  shareVideosBusyLabel,
  shareVideosLabel,
  shouldOfferPhotosSave,
} from "@/lib/shareVideos";
import {
  assignGalleryFolder,
  createGalleryFolder,
  deleteGalleryFolder,
  getDriveStatus,
  listDestinations,
  listGalleryFolders,
  renameGalleryFolder,
} from "@/lib/api";
import type { Destination, DriveStatus, GalleryFolder, SourceOut } from "@/lib/types";
import {
  GALLERY_FOLDER_ALL,
  GALLERY_FOLDER_UNFILED,
  filterSourcesByFolder,
  folderNameForId,
  galleryFolderEmptyCopy,
  galleryFolderUnfiledEmptyCopy,
} from "@/lib/galleryFolders";
import { GalleryFolderBar } from "@/components/gallery/GalleryFolderBar";
import { GalleryToolbar } from "@/components/gallery/GalleryToolbar";
import { GalleryFloatingToolbar } from "@/components/gallery/GalleryFloatingToolbar";
import { PackList } from "@/components/gallery/PackList";
import { SourceGroup } from "@/components/gallery/SourceGroup";
import { PackLiveStrip } from "@/components/gallery/PackLiveStrip";
import { VariantSheet } from "@/components/variant/VariantSheet";
import { SendToDriveModal } from "@/components/drive/SendToDriveModal";

type FilterMode = "all" | "shortfall";
type SortMode = "newest";

export function GalleryContent() {
  const { data: sources, mutate, isLoading } = useGallery();
  const { complete } = useRun();
  const searchParams = useSearchParams();

  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [sort, setSort] = useState<SortMode>("newest");
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [packSearch, setPackSearch] = useState("");
  const [folders, setFolders] = useState<GalleryFolder[]>([]);
  const [unassignedCount, setUnassignedCount] = useState(0);
  const [activeFolderId, setActiveFolderId] = useState(GALLERY_FOLDER_ALL);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [driveStatus, setDriveStatus] = useState<DriveStatus | null>(null);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [sheetQuery, setSheetQuery] = useState<{ sourceId: string; index: number } | null | undefined>(
    undefined,
  );
  const [offerPhotos, setOfferPhotos] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [pendingShareFiles, setPendingShareFiles] = useState<File[] | null>(null);
  const fileCacheRef = useRef(new Map<string, File>());

  // Load Drive status + destinations once, in parallel with the gallery SWR fetch.
  function refreshFolders() {
    return listGalleryFolders()
      .then((out) => {
        setFolders(out.folders);
        setUnassignedCount(out.unassigned_count);
      })
      .catch((e) => console.error("Failed to load gallery folders", e));
  }

  useEffect(() => {
    Promise.all([getDriveStatus(), listDestinations()])
      .then(([status, dests]) => {
        setDriveStatus(status);
        setDestinations(dests);
      })
      .catch((e) => console.error("Failed to load Drive status", e));
    void refreshFolders();
  }, []);

  useEffect(() => {
    const nav = typeof navigator === "undefined" ? undefined : navigator;
    setOfferPhotos(shouldOfferPhotosSave(nav, nav?.userAgent, nav?.maxTouchPoints));
  }, []);

  function handleToggleVariant(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Revalidate gallery when active run completes
  useEffect(() => {
    if (complete) {
      mutate();
    }
  }, [complete, mutate]);

  // `undefined` = follow the address bar (deep link). Local value opens/closes
  // immediately so we never wait on a Next.js remount.
  const urlQuery = parseGalleryVariantQuery(searchParams.get("v"));
  const activeQuery = sheetQuery === undefined ? urlQuery : sheetQuery;

  const allSources = sources ?? [];
  const sheetSource = activeQuery
    ? allSources.find((s) => s.source_id === activeQuery.sourceId)
    : undefined;
  const sheetIndex = activeQuery?.index ?? null;
  const pos =
    sheetSource && sheetIndex !== null
      ? sheetSource.variants.findIndex((v) => v.index === sheetIndex)
      : -1;

  function handleOpenVariant(sourceId: string, index: number) {
    setSheetQuery({ sourceId, index });
    setSelectedPackId(sourceId);
    pushGallerySearch(gallerySearchPath(sourceId, index));
  }

  function handleSheetClose() {
    setSheetQuery(null);
    pushGallerySearch(gallerySearchPath());
  }

  function handleSheetNav(delta: number) {
    if (!sheetSource || pos < 0) return;
    const next = Math.min(
      Math.max(0, pos + delta),
      sheetSource.variants.length - 1,
    );
    const index = sheetSource.variants[next].index;
    setSheetQuery({ sourceId: sheetSource.source_id, index });
    pushGallerySearch(gallerySearchPath(sheetSource.source_id, index));
  }

  useEffect(() => {
    function onPop() {
      setSheetQuery(parseGalleryVariantQuery(new URLSearchParams(window.location.search).get("v")));
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const filtered = filterSourcesByFolder(
    filterSources(allSources, filterMode),
    activeFolderId,
  );
  const sorted = sortSources(filtered, sort);
  const folderLabels = Object.fromEntries(
    allSources
      .map((source) => [source.source_id, folderNameForId(folders, source.gallery_folder_id)] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[1])),
  );

  // A deep-linked/open variant sheet (via ?v=) takes priority so the PACKS
  // list stays focused on it; otherwise the last pack clicked, else the top one.
  const activePackId = activeQuery?.sourceId ?? selectedPackId ?? undefined;
  const activePack = sorted.find((s) => s.source_id === activePackId) ?? sorted[0];

  const totalVariants = allSources.reduce((acc, s) => acc + filesReadyCount(s), 0);

  const okRefs = okVariantRefs(allSources, selected);
  const selectedJobIds = [
    ...new Set(
      okRefs
        .map((r) => allSources.find((s) => s.source_id === r.source_id)?.job_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const splitJobId = selectedJobIds.length === 1 ? selectedJobIds[0] : undefined;
  const disabledReason = sendDisabledReason(driveStatus, destinations, okRefs);
  const packForSelect = activePack ? [activePack] : [];
  const visibleOkCount = okVariantKeys(packForSelect).length;
  const allVisibleSelected = selectionHasAllOk(selected, packForSelect);
  const selectedVariants = selectedShareableVariants(allSources, selected);

  useEffect(() => {
    if (selected.size === 0) {
      setPendingShareFiles(null);
      setSaveMsg(null);
    }
  }, [selected.size]);

  function handleSelectAllVisible() {
    if (!activePack) return;
    setSelected((prev) => withOkSelection(prev, [activePack], !allVisibleSelected));
  }

  function handleToggleSelectSource(source: SourceOut, select: boolean) {
    setSelected((prev) => withOkSelection(prev, [source], select));
  }

  function handleSaveSelected() {
    if (saveBusy || okRefs.length === 0) return;
    const nav = typeof navigator === "undefined" ? undefined : navigator;
    const ready = filesReadyNow(fileCacheRef.current, selectedVariants, pendingShareFiles);
    if (!ready) {
      setSaveBusy(true);
      setSaveMsg(shareLoadingCopy());
      void fillFileCache(fileCacheRef.current, selectedVariants)
        .then((files) => {
          setPendingShareFiles(files.length ? files : null);
          setSaveMsg(files.length ? shareRetryCopy() : shareEmptyCopy());
        })
        .catch(() => setSaveMsg(shareEmptyCopy()))
        .finally(() => setSaveBusy(false));
      return;
    }
    setSaveBusy(true);
    setSaveMsg(null);
    void saveOrShareVideoFiles(ready, {
      share: nav,
      userAgent: nav?.userAgent,
      maxTouchPoints: nav?.maxTouchPoints,
    })
      .then((outcome) => {
        if (outcome.result === "needs_gesture") {
          setPendingShareFiles(outcome.remaining);
          setSaveMsg(shareOutcomeMessage(outcome));
          return;
        }
        setPendingShareFiles(null);
        if (outcome.result === "unsupported") setSaveMsg(shareEmptyCopy());
      })
      .catch(() => setSaveMsg(shareEmptyCopy()))
      .finally(() => setSaveBusy(false));
  }

  function handleRemoveSource(source: SourceOut) {
    setSelected((prev) => {
      const next = new Set(prev);
      const prefix = `${source.source_id}:`;
      for (const key of [...next]) {
        if (key.startsWith(prefix)) next.delete(key);
      }
      return next;
    });
    mutate();
    void refreshFolders();
  }

  function handleSendModalClose() {
    setSendModalOpen(false);
    setSelected(new Set());
  }

  return (
    <main className="gallery-page">
      <GalleryFolderBar
        folders={folders}
        unassignedCount={unassignedCount}
        totalCount={allSources.length}
        selectedId={activeFolderId}
        onSelect={setActiveFolderId}
        onCreate={async (name) => {
          await createGalleryFolder(name);
          await refreshFolders();
        }}
        onRename={async (id, name) => {
          await renameGalleryFolder(id, name);
          await refreshFolders();
        }}
        onDelete={async (id) => {
          const wasLast = folders.length === 1 && folders[0].id === id;
          await deleteGalleryFolder(id);
          if (activeFolderId === id || wasLast) setActiveFolderId(GALLERY_FOLDER_ALL);
          await Promise.all([mutate(), refreshFolders()]);
        }}
      />

      <GalleryToolbar
        count={sorted.length}
        variantCount={totalVariants}
        crumb={activePack?.filename}
        review={
          sheetSource && pos >= 0
            ? {
                variantLabel: `v${String(sheetSource.variants[pos].index).padStart(2, "0")}`,
                onBack: handleSheetClose,
                onPrev: () => handleSheetNav(-1),
                onNext: () => handleSheetNav(1),
                canPrev: pos > 0,
                canNext: pos < sheetSource.variants.length - 1,
              }
            : null
        }
        filterMode={filterMode}
        onFilter={setFilterMode}
        sort={sort}
        onSort={setSort}
        selectedCount={okRefs.length}
        sendDisabledReason={disabledReason}
        onSend={() => setSendModalOpen(true)}
        selectAllLabel={selectAllLabel(allVisibleSelected)}
        selectAllDisabled={visibleOkCount === 0}
        onSelectAll={handleSelectAllVisible}
        saveLabel={saveBusy ? shareVideosBusyLabel() : shareVideosLabel(offerPhotos)}
        saveBusy={saveBusy}
        saveDisabledReason={
          okRefs.length === 0
            ? saveNoneSelectedCopy()
            : null
        }
        saveHint={phoneShareHintCopy()}
        onSave={() => { handleSaveSelected(); }}
        saveMsg={saveMsg}
      />

      <div className={sheetSource && pos >= 0 ? "gallery-body gallery-body--review" : "gallery-body"}>
        <PackList
          packs={sorted}
          totalCount={sorted.length}
          folderLabels={folderLabels}
          activeId={activePack?.source_id}
          onSelect={(id) => {
            setSelectedPackId(id);
            if (sheetSource) handleSheetClose();
          }}
          search={packSearch}
          onSearchChange={setPackSearch}
          loading={isLoading}
        />

        <div className="gallery-main">
        {activePack && !(sheetSource && pos >= 0) && <PackLiveStrip source={activePack} />}

        <section className={sheetSource && pos >= 0 ? "gallery-grid-pane gallery-grid-pane--review" : "gallery-grid-pane"}>
          {isLoading && <div className="gallery-loading">Loading gallery…</div>}

          {!isLoading && sorted.length === 0 && (
            <div className="gallery-empty">
              <div className="gallery-empty__icon">⬡</div>
              <strong>
                {activeFolderId === GALLERY_FOLDER_UNFILED
                  ? "Unfiled is empty"
                  : activeFolderId
                    ? "Empty folder"
                    : filterMode === "shortfall" ? "No packs need attention" : "No completed runs yet"}
              </strong>
              <p>
                {activeFolderId === GALLERY_FOLDER_UNFILED
                  ? galleryFolderUnfiledEmptyCopy()
                  : activeFolderId
                    ? galleryFolderEmptyCopy()
                    : filterMode === "shortfall"
                      ? "All packs have delivered their full requested count."
                      : "Start a run in Studio. Live packs show Generating here while copies finish."}
              </p>
            </div>
          )}

          {!isLoading && activePack && !(sheetSource && pos >= 0) && (
            <SourceGroup
              key={activePack.source_id}
              source={activePack}
              onOpenVariant={handleOpenVariant}
              onRegenerate={() => mutate()}
              selected={selected}
              onToggleVariant={handleToggleVariant}
              onToggleSelectSource={handleToggleSelectSource}
              onRemove={() => handleRemoveSource(activePack)}
              folders={folders}
              onAssignFolder={async (folderId) => {
                await assignGalleryFolder(activePack.source_id, folderId);
                await Promise.all([mutate(), refreshFolders()]);
              }}
            />
          )}

          {sheetSource && pos >= 0 && (
            <VariantSheet
              embedded
              sourceId={sheetSource.source_id}
              sourceName={sheetSource.filename.replace(/\.[^.]+$/, "")}
              variants={sheetSource.variants}
              index={pos}
              onClose={handleSheetClose}
              onNav={handleSheetNav}
              onRegenerate={() => mutate()}
              selectedCount={okRefs.length}
              flaggedCount={sheetSource.variants.filter((v) => v.platform_result === "flagged" || v.platform_result === "duplicate_reject").length}
              packAvgPct={avgOriginalityPct(sheetSource)}
              onSendToDrive={disabledReason == null ? () => setSendModalOpen(true) : undefined}
            />
          )}

          {selected.size > 0 && !(sheetSource && pos >= 0) && (
            <GalleryFloatingToolbar
              count={selected.size}
              onSend={() => setSendModalOpen(true)}
              sendDisabled={disabledReason != null}
              sendTitle={disabledReason}
              onSave={handleSaveSelected}
              saveLabel={saveBusy ? shareVideosBusyLabel() : shareVideosLabel(offerPhotos)}
              saveDisabled={
                saveBusy ||
                okRefs.length === 0
              }
              saveTitle={phoneShareHintCopy()}
              onClose={() => setSelected(new Set())}
            />
          )}
        </section>
        </div>
      </div>

      {/* Send to Drive modal — only opened when the toolbar button is enabled */}
      {sendModalOpen && (
        <SendToDriveModal
          refs={okRefs}
          destinations={destinations}
          jobId={splitJobId}
          onClose={handleSendModalClose}
        />
      )}
    </main>
  );
}

export default function GalleryPage() {
  return (
    <Suspense
        fallback={
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "60px 0",
              color: "var(--color-muted)",
              fontSize: 13,
            }}
          >
            Loading…
          </div>
        }
    >
      <GalleryContent />
    </Suspense>
  );
}

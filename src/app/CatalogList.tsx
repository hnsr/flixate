import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";
import { SynopsisRepository } from "../data/catalog.js";
import type { CatalogDocument, CoreTitle, TitleKey } from "../domain/catalog.js";
import { CatalogCard } from "./CatalogCard.js";

type CatalogListProps = {
  catalog: CatalogDocument;
  titles: CoreTitle[];
  seenKeys: ReadonlySet<TitleKey>;
  onToggleSeen: (key: TitleKey) => void;
};

export function CatalogList(props: CatalogListProps): React.JSX.Element {
  const scrollElement = useRef<HTMLDivElement>(null);
  const synopsisRepository = useRef(new SynopsisRepository()).current;
  const virtualizer = useVirtualizer({
    count: props.titles.length,
    getScrollElement: () => scrollElement.current,
    estimateSize: () => 226,
    overscan: 5,
    getItemKey: (index) => props.titles[index]?.key ?? index,
  });

  if (props.titles.length === 0) {
    return (
      <div className="empty-state">
        <span aria-hidden="true">×</span>
        <h3>Nothing fits that combination</h3>
        <p>Try lowering the score, widening the genres, or bringing seen titles back in.</p>
      </div>
    );
  }

  if (props.titles.length <= 60) {
    return (
      <div className="catalog-list">
        {props.titles.map((title) => (
          <CatalogCard
            key={title.key}
            catalog={props.catalog}
            title={title}
            seen={props.seenKeys.has(title.key)}
            synopsisRepository={synopsisRepository}
            onToggleSeen={() => props.onToggleSeen(title.key)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="catalog-scroll" ref={scrollElement}>
      <div className="virtual-list" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const title = props.titles[item.index];
          if (!title) return null;
          return (
            <div
              className="virtual-row"
              key={title.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <CatalogCard
                catalog={props.catalog}
                title={title}
                seen={props.seenKeys.has(title.key)}
                synopsisRepository={synopsisRepository}
                onToggleSeen={() => props.onToggleSeen(title.key)}
                onSizeChange={() => virtualizer.measure()}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

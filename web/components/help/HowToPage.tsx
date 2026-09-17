"use client";

import { useState } from "react";
import Link from "next/link";
import { CircleHelp } from "lucide-react";
import {
  HOW_TO_CATEGORIES,
  HOW_TO_EYEBROW,
  HOW_TO_LEAD,
  HOW_TO_TITLE,
  type HowToCategory,
} from "@/lib/howTo";

export function HowToPage() {
  const [activeId, setActive] = useState<HowToCategory["id"]>(HOW_TO_CATEGORIES[0].id);
  const category = HOW_TO_CATEGORIES.find((item) => item.id === activeId) ?? HOW_TO_CATEGORIES[0];

  return (
    <main className="how-to-page">
      <div className="workspace-heading">
        <span className="workspace-heading__icon">
          <CircleHelp size={19} />
        </span>
        <div>
          <p className="workspace-heading__eyebrow">{HOW_TO_EYEBROW}</p>
          <h1>{HOW_TO_TITLE}</h1>
          <p className="workspace-heading__copy">{HOW_TO_LEAD}</p>
        </div>
      </div>

      <article className="how-to-article">
        <div className="how-to-tabs" role="tablist" aria-label="How-to categories">
          {HOW_TO_CATEGORIES.map((item) => {
            const selected = item.id === category.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`how-to-tab-${item.id}`}
                aria-selected={selected}
                aria-controls={`how-to-panel-${item.id}`}
                tabIndex={selected ? 0 : -1}
                data-active={selected}
                onClick={() => setActive(item.id)}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <div
          className="how-to-panel"
          role="tabpanel"
          id={`how-to-panel-${category.id}`}
          aria-labelledby={`how-to-tab-${category.id}`}
        >
          <p className="how-to-blurb">{category.blurb}</p>
          {category.topics.map((topic) => (
            <section key={topic.id} className="how-to-section" aria-labelledby={`how-to-${topic.id}`}>
              <h2 id={`how-to-${topic.id}`}>{topic.title}</h2>
              {topic.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>
          ))}
          {category.jumps.length > 0 && (
            <nav className="how-to-jumps" aria-label={`Open ${category.label}`}>
              {category.jumps.map((link) => (
                <Link key={link.href} href={link.href}>
                  {link.label}
                </Link>
              ))}
            </nav>
          )}
        </div>
      </article>
    </main>
  );
}

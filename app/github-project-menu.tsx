"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type ProjectIconName =
  | "book"
  | "history"
  | "branch"
  | "pull-request"
  | "insights"
  | "profile"
  | "external"
  | "chevron";

type GitHubProjectMenuProps = {
  caseHref: string;
};

function ProjectIcon({
  name,
  size = 16,
}: {
  name: ProjectIconName;
  size?: number;
}) {
  if (name === "chevron") {
    return (
      <svg
        aria-hidden="true"
        className="project-menu-icon"
        fill="none"
        height={size}
        viewBox="0 0 16 16"
        width={size}
      >
        <path
          d="m4 6 4 4 4-4"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
      </svg>
    );
  }

  if (name === "book") {
    return (
      <svg
        aria-hidden="true"
        className="project-menu-icon"
        fill="none"
        height={size}
        viewBox="0 0 16 16"
        width={size}
      >
        <path
          d="M3.25 2.75h7.5A2.25 2.25 0 0 1 13 5v8.25H5.5a2.25 2.25 0 0 0-2.25 2.25V2.75Z"
          stroke="currentColor"
          strokeLinejoin="round"
        />
        <path
          d="M3.25 13.25A2.25 2.25 0 0 1 5.5 11H13"
          stroke="currentColor"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (name === "history") {
    return (
      <svg
        aria-hidden="true"
        className="project-menu-icon"
        fill="none"
        height={size}
        viewBox="0 0 16 16"
        width={size}
      >
        <path
          d="M3.1 6.1A5.75 5.75 0 1 1 4.7 11"
          stroke="currentColor"
          strokeLinecap="round"
        />
        <path
          d="M3 2.75v3.5h3.5M8 5.25v3l2 1"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (name === "branch") {
    return (
      <svg
        aria-hidden="true"
        className="project-menu-icon"
        fill="none"
        height={size}
        viewBox="0 0 16 16"
        width={size}
      >
        <circle cx="5" cy="3.5" r="1.75" stroke="currentColor" />
        <circle cx="11" cy="12.5" r="1.75" stroke="currentColor" />
        <circle cx="5" cy="12.5" r="1.75" stroke="currentColor" />
        <path
          d="M5 5.25v5.5M6.75 12.5h2.5A1.75 1.75 0 0 0 11 10.75v-2"
          stroke="currentColor"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (name === "pull-request") {
    return (
      <svg
        aria-hidden="true"
        className="project-menu-icon"
        fill="none"
        height={size}
        viewBox="0 0 16 16"
        width={size}
      >
        <circle cx="4" cy="3.5" r="1.75" stroke="currentColor" />
        <circle cx="12" cy="12.5" r="1.75" stroke="currentColor" />
        <path
          d="M4 5.25v5.5A1.75 1.75 0 0 0 5.75 12.5h4.5M12 10.75v-5.5M10 7.25l2-2 2 2"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (name === "insights") {
    return (
      <svg
        aria-hidden="true"
        className="project-menu-icon"
        fill="none"
        height={size}
        viewBox="0 0 16 16"
        width={size}
      >
        <path
          d="M2.5 13.25h11M4 11V8.5M8 11V5M12 11V2.75"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.25"
        />
      </svg>
    );
  }

  if (name === "profile") {
    return (
      <svg
        aria-hidden="true"
        className="project-menu-icon"
        fill="none"
        height={size}
        viewBox="0 0 16 16"
        width={size}
      >
        <circle cx="8" cy="5" r="2.25" stroke="currentColor" />
        <path
          d="M3.75 13a4.25 4.25 0 0 1 8.5 0"
          stroke="currentColor"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      className="project-menu-icon"
      fill="none"
      height={size}
      viewBox="0 0 16 16"
      width={size}
    >
      <path
        d="M5.5 3.5h-2v9h9v-2M8 2.5h4.5V7M7 9l5.25-5.25"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function GitHubProjectMenu({
  caseHref,
}: GitHubProjectMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    function closeOnOutsideClick(event: PointerEvent): void {
      if (
        menuRef.current !== null &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsideClick);

    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsideClick);
    };
  }, [isOpen]);

  function toggleMenu(): void {
    setStatusMessage(null);
    setIsOpen((open) => !open);
  }

  function showProfileStatus(): void {
    setStatusMessage("Profile is still in progress.");
  }

  return (
    <div className="project-menu" ref={menuRef}>
      <button
        aria-controls="git-court-project-menu"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className="project-menu-trigger"
        onClick={toggleMenu}
        type="button"
      >
        <span className="project-menu-avatar" aria-hidden="true">
          GC
        </span>
        <span className="project-menu-trigger-label">Menu</span>
        <ProjectIcon name="chevron" size={14} />
      </button>

      {isOpen ? (
        <div
          aria-label="Git Court project menu"
          className="project-menu-panel"
          id="git-court-project-menu"
          role="menu"
        >
          <div className="project-menu-heading">
            <span className="project-menu-avatar" aria-hidden="true">
              GC
            </span>
            <div>
              <strong>Git Court</strong>
              <span>Public legal history workspace</span>
            </div>
          </div>

          <div className="project-menu-links">
            <Link
              className="project-menu-item"
              href={caseHref}
              role="menuitem"
              onClick={() => setIsOpen(false)}
            >
              <ProjectIcon name="book" />
              <span>
                <strong>Cases</strong>
                <small>Browse public case repositories</small>
              </span>
            </Link>
            <Link
              className="project-menu-item"
              href={`${caseHref}#history-title`}
              role="menuitem"
              onClick={() => setIsOpen(false)}
            >
              <ProjectIcon name="history" />
              <span>
                <strong>Docket history</strong>
                <small>Read source-linked milestones</small>
              </span>
            </Link>
            <Link
              className="project-menu-item"
              href={`${caseHref}#moot-title`}
              role="menuitem"
              onClick={() => setIsOpen(false)}
            >
              <ProjectIcon name="branch" />
              <span>
                <strong>Moot court</strong>
                <small>Fork a case and build an argument</small>
              </span>
            </Link>
            <Link
              className="project-menu-item"
              href={`${caseHref}#review-title`}
              role="menuitem"
              onClick={() => setIsOpen(false)}
            >
              <ProjectIcon name="pull-request" />
              <span>
                <strong>Reviews</strong>
                <small>Inspect pull requests and accountability</small>
              </span>
            </Link>
            <Link
              className="project-menu-item"
              href={`${caseHref}#insights`}
              role="menuitem"
              onClick={() => setIsOpen(false)}
            >
              <ProjectIcon name="insights" />
              <span>
                <strong>Insights</strong>
                <small>Explore case composition and contributors</small>
              </span>
            </Link>
          </div>

          <div className="project-menu-divider" />

          <button
            className="project-menu-item project-menu-profile"
            onClick={showProfileStatus}
            role="menuitem"
            type="button"
          >
            <ProjectIcon name="profile" />
            <span>
              <strong>Profile</strong>
              <small>Personal workspace</small>
            </span>
          </button>

          {statusMessage ? (
            <p className="project-menu-status" role="status">
              {statusMessage}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

import { Plugin, MarkdownPostProcessorContext, TFile } from "obsidian";

interface TimeEntry {
  start: string; // ISO timestamp
  end: string | null; // ISO timestamp or null if still running
}

interface TimeTrackerData {
  entries: TimeEntry[];
  activeStart: string | null; // ISO timestamp if a session is currently active
}

export default class TimeTrackerPlugin extends Plugin {
  async onload() {
    this.registerMarkdownCodeBlockProcessor(
      "time-tracker",
      (source, el, ctx) => this.processTimeTrackerBlock(source, el, ctx)
    );
  }

  private processTimeTrackerBlock(
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext
  ): void {
    // Parse existing data
    let data: TimeTrackerData;
    try {
      const trimmed = source.trim();
      if (trimmed === "" || trimmed === "[]") {
        data = { entries: [], activeStart: null };
      } else {
        data = JSON.parse(trimmed);
        // Handle legacy format (plain array)
        if (Array.isArray(data)) {
          data = { entries: data, activeStart: null };
        }
      }
    } catch {
      data = { entries: [], activeStart: null };
    }

    // Container
    const container = el.createDiv({ cls: "time-tracker-container" });

    // Controls
    const controls = container.createDiv({ cls: "time-tracker-controls" });

    const isRunning = data.activeStart !== null;

    const btn = controls.createEl("button", {
      cls: `time-tracker-btn ${isRunning ? "time-tracker-btn-stop" : "time-tracker-btn-start"}`,
      text: isRunning ? "Stop" : "Start",
    });

    if (isRunning) {
      const statusEl = controls.createSpan({ cls: "time-tracker-status" });
      statusEl.setText(`Started at ${this.formatTime(data.activeStart!)}`);
    }

    btn.addEventListener("click", async () => {
      await this.handleButtonClick(data, ctx);
    });

    // Table
    if (data.entries.length > 0) {
      const table = container.createEl("table", { cls: "time-tracker-table" });
      const thead = table.createEl("thead");
      const headerRow = thead.createEl("tr");
      headerRow.createEl("th", { text: "Start" });
      headerRow.createEl("th", { text: "End" });
      headerRow.createEl("th", { text: "Duration" });

      const tbody = table.createEl("tbody");
      let totalMinutes = 0;

      // Display newest entries first
      const sortedEntries = [...data.entries].reverse();
      for (const entry of sortedEntries) {
        const row = tbody.createEl("tr");
        row.createEl("td", { text: this.formatDateTime(entry.start) });
        row.createEl("td", {
          text: entry.end ? this.formatDateTime(entry.end) : "—",
        });
        row.createEl("td", {
          text: entry.end ? this.formatDuration(entry.start, entry.end) : "—",
        });

        if (entry.end) {
          const start = new Date(entry.start).getTime();
          const end = new Date(entry.end).getTime();
          totalMinutes += Math.round((end - start) / 60000);
        }
      }

      // Total row
      const tfoot = table.createEl("tfoot");
      const totalRow = tfoot.createEl("tr");
      totalRow.createEl("td", { text: "Total" });
      totalRow.createEl("td", { text: "" });
      totalRow.createEl("td", { text: this.formatTotalMinutes(totalMinutes) });
    } else if (!isRunning) {
      container.createDiv({
        cls: "time-tracker-empty",
        text: "No sessions recorded yet.",
      });
    }
  }

  private async handleButtonClick(
    data: TimeTrackerData,
    ctx: MarkdownPostProcessorContext
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!(file instanceof TFile)) return;

    const now = new Date().toISOString();

    if (data.activeStart === null) {
      // Start a new session
      data.activeStart = now;
    } else {
      // Stop the current session
      data.entries.push({
        start: data.activeStart,
        end: now,
      });
      data.activeStart = null;
    }

    // Update the file
    const content = await this.app.vault.read(file);
    const newBlockContent = JSON.stringify(data, null, 2);

    // Find and replace the time-tracker block
    const updatedContent = this.replaceTimeTrackerBlock(
      content,
      ctx,
      newBlockContent
    );

    await this.app.vault.modify(file, updatedContent);

    // Sync total time to frontmatter property
    await this.syncTimeToFrontmatter(file, data);
  }

  private async syncTimeToFrontmatter(
    file: TFile,
    data: TimeTrackerData
  ): Promise<void> {
    const totalMinutes = this.calculateTotalMinutes(data.entries);
    const formatted = this.formatTotalMinutes(totalMinutes);
    
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter["time-logged"] = formatted;
    });
  }

  private calculateTotalMinutes(entries: TimeEntry[]): number {
    let totalMinutes = 0;
    for (const entry of entries) {
      if (entry.end) {
        const start = new Date(entry.start).getTime();
        const end = new Date(entry.end).getTime();
        totalMinutes += Math.round((end - start) / 60000);
      }
    }
    return totalMinutes;
  }

  private replaceTimeTrackerBlock(
    content: string,
    ctx: MarkdownPostProcessorContext,
    newBlockContent: string
  ): string {
    // Use section info to find the exact location
    const sectionInfo = ctx.getSectionInfo(ctx.el);
    if (sectionInfo) {
      const lines = content.split("\n");
      const startLine = sectionInfo.lineStart;
      const endLine = sectionInfo.lineEnd;

      // Reconstruct: keep opening fence, replace content, keep closing fence
      const before = lines.slice(0, startLine + 1).join("\n");
      const after = lines.slice(endLine).join("\n");

      return before + "\n" + newBlockContent + "\n" + after;
    }

    // Fallback: regex replacement
    const blockRegex = /```time-tracker\n[\s\S]*?\n```/;
    return content.replace(
      blockRegex,
      "```time-tracker\n" + newBlockContent + "\n```"
    );
  }

  private formatTime(isoString: string): string {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  private formatDateTime(isoString: string): string {
    const date = new Date(isoString);
    return date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  private formatDuration(startIso: string, endIso: string): string {
    const start = new Date(startIso).getTime();
    const end = new Date(endIso).getTime();
    const diffMs = end - start;
    const minutes = Math.round(diffMs / 60000);

    if (minutes < 60) {
      return `${minutes} min`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }

  private formatTotalMinutes(minutes: number): string {
    if (minutes < 60) {
      return `${minutes} min`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }
}

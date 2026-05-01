"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { StatusPill } from "@/components/StatusPill";
import type { CaseStatus } from "@/types/case-status";
import { scanMobileStatusLabel } from "@/lib/scan-mobile-data-contract";
import styles from "./scan-landing.module.css";

export function ScanTodayClient() {
  const today = useQuery(api.scanMobile.todayForUser, {});

  if (today === undefined) {
    return (
      <section className={styles.todayPanel} aria-busy="true" aria-label="Loading today">
        <div className={styles.todayEmpty}>Loading today&apos;s custody and manifest work...</div>
      </section>
    );
  }

  const inCustody = today.sections.find((section) => section.key === "in_custody");
  const plan = today.sections.find((section) => section.key === "todays_plan");
  const inCustodyCases = inCustody && "cases" in inCustody ? (inCustody.cases ?? []) : [];
  const planItems = plan && "items" in plan ? (plan.items ?? []) : [];

  return (
    <section className={styles.todayPanel} aria-label="Today">
      <div className={styles.todayStats}>
        <div className={styles.todayStat}>
          <strong>{today.stats.inHand}</strong>
          <span>In hand</span>
        </div>
        <div className={styles.todayStat}>
          <strong>{today.stats.todaysStops}</strong>
          <span>Stops</span>
        </div>
        <div className={styles.todayStat}>
          <strong>{today.stats.flags}</strong>
          <span>Flags</span>
        </div>
      </div>

      <div className={styles.todaySectionHeader}>
        <h2>In your custody</h2>
        <span>{today.stats.inHand}</span>
      </div>
      <div className={styles.todayList}>
        {inCustodyCases.length > 0 ? (
          inCustodyCases.slice(0, 3).map((summary) => (
            <Link
              key={summary.case._id}
              className={styles.todayRow}
              href={`/scan/${summary.case._id}`}
            >
              <div>
                <strong>{summary.case.label}</strong>
                <span>
                  {summary.case.locationName ?? summary.case.destinationName ?? "Location pending"}
                  {" · "}
                  {summary.latestCustody?.toUserName ?? summary.case.assigneeName ?? "Unassigned"}
                </span>
              </div>
              <StatusPill
                kind={summary.case.status as CaseStatus}
                label={scanMobileStatusLabel(summary.case.status as CaseStatus)}
              />
            </Link>
          ))
        ) : (
          <p className={styles.todayEmpty}>No cases are currently assigned to you.</p>
        )}
      </div>

      <div className={styles.todaySectionHeader}>
        <h2>Today&apos;s plan</h2>
        <span>{today.stats.todaysStops}</span>
      </div>
      <div className={styles.todayList}>
        {planItems.length > 0 ? (
          planItems.slice(0, 3).map((item) => (
            <Link key={`${item.type}-${item.caseId}`} className={styles.todayRow} href={`/scan/${item.caseId}`}>
              <div>
                <strong>{item.label}</strong>
                <span>{item.detail}</span>
              </div>
              <span className={styles.todayChevron}>›</span>
            </Link>
          ))
        ) : (
          <p className={styles.todayEmpty}>No manifest or arrival tasks queued.</p>
        )}
      </div>
    </section>
  );
}

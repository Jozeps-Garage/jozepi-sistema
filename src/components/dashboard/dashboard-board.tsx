"use client";

import { useEffect } from "react";
import {
  AgendaWidget,
  CashflowWidget,
  ChartWidget,
  ClientsWidget,
  LowStockWidget,
  RevenueWidget,
  ServicesWidget,
} from "@/components/dashboard/dashboard-widgets";
import type { DashboardData } from "@/lib/dashboard/types";

const LEGACY_LAYOUT_STORAGE_KEY = "auto-estetica-dashboard-layout";

export function DashboardBoard({ data }: { data: DashboardData }) {
  useEffect(() => {
    try {
      window.localStorage.removeItem(LEGACY_LAYOUT_STORAGE_KEY);
    } catch {
      // Ignora falhas de armazenamento local.
    }
  }, []);

  return (
    <div className="dashboard-page">
      <div className="mb-3">
        <h1 className="font-brand text-xl font-light tracking-wide text-foreground sm:text-2xl">
          {data.greeting}, {data.greetingName}.
        </h1>
        <p className="page-subtitle mt-1 text-sm">{data.dateLabel}</p>
      </div>

      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-6">
        <div className="lg:col-span-2">
          <RevenueWidget data={data} />
        </div>
        <div className="lg:col-span-2">
          <ClientsWidget data={data} />
        </div>
        <div className="lg:col-span-2">
          <ServicesWidget data={data} />
        </div>

        <div className="lg:col-span-4">
          <CashflowWidget data={data} />
        </div>
        <div className="lg:col-span-2">
          <AgendaWidget data={data} />
        </div>

        <div className="lg:col-span-4">
          <ChartWidget data={data} />
        </div>
        <div className="lg:col-span-2">
          <LowStockWidget data={data} />
        </div>
      </div>
    </div>
  );
}

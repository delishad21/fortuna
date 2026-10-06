"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { type Trip } from "@/app/actions/trips";
import { deleteTrip, updateTrip } from "@/lib/tripMutations";
import { tripSharingOf } from "@/lib/tripSharingMutations";
import { useHeaderConfig } from "@/components/Layouts/header-context";
import { Button } from "@/components/ui/Button";
import { DatePicker } from "@/components/ui/DatePicker";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { TextInput } from "@/components/ui/TextInput";
import {
  DEFAULT_TRIP_COVER_URL,
  TRIP_STATUS_OPTIONS,
  TripCoverUploadButton,
} from "@/components/trips/TripsClient";
import { getCurrencyOptions } from "@/lib/currencies";

interface TripDetailsClientProps {
  trip: Trip;
  /** The trip has entries or funding, so its base currency is fixed. */
  hasActivity: boolean;
}

export function TripDetailsClient({ trip, hasActivity }: TripDetailsClientProps) {
  // In a shared trip the owner manages the name, dates, status, cover and currency.
  const sharing = tripSharingOf(trip);
  const sharedLocked = !!sharing && sharing.role !== "owner";
  const router = useRouter();
  const { setHeaderConfig } = useHeaderConfig();
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    type: "success" | "error" | "warning" | "info";
    title: string;
    message: string;
  }>({
    isOpen: false,
    type: "info",
    title: "",
    message: "",
  });

  const [form, setForm] = useState({
    name: trip.name || "",
    coverImageUrl: trip.coverImageUrl || "",
    baseCurrency: trip.baseCurrency || "SGD",
    startDate: trip.startDate ? String(trip.startDate).slice(0, 10) : "",
    endDate: trip.endDate ? String(trip.endDate).slice(0, 10) : "",
    status: trip.status || "active",
    notes: trip.notes || "",
  });
  const currencyOptions = useMemo(() => getCurrencyOptions(), []);

  useEffect(() => {
    setHeaderConfig({
      title: `${trip.name} · Details`,
      showBack: true,
      backHref: `/trips/${trip.id}`,
    });
    return () => setHeaderConfig(null);
  }, [setHeaderConfig, trip.id, trip.name]);

  const showModal = (
    type: "success" | "error" | "warning" | "info",
    title: string,
    message: string,
  ) => {
    setModalState({ isOpen: true, type, title, message });
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      showModal("warning", "Name Required", "Trip name cannot be empty.");
      return;
    }
    if (!form.startDate) {
      showModal("warning", "Start Date Required", "Start date is required.");
      return;
    }
    if (form.endDate && form.endDate < form.startDate) {
      showModal("warning", "Check Dates", "End date can't be before the start date.");
      return;
    }

    setIsSaving(true);
    try {
      if (sharedLocked) {
        await updateTrip(trip.id, { notes: form.notes.trim() || null });
        showModal("success", "Saved", "Notes updated.");
        router.refresh();
        return;
      }
      await updateTrip(trip.id, {
        name: form.name.trim(),
        ...(form.baseCurrency !== trip.baseCurrency
          ? { baseCurrency: form.baseCurrency }
          : {}),
        coverImageUrl: form.coverImageUrl.trim() || null,
        startDate: form.startDate,
        endDate: form.endDate || null,
        status: form.status,
        notes: form.notes.trim() || null,
      });
      showModal("success", "Saved", "Trip details updated.");
      router.refresh();
    } catch (error) {
      showModal(
        "error",
        "Save Failed",
        error instanceof Error ? error.message : "Could not update trip.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteTrip(trip.id);
      setShowDeleteConfirm(false);
      router.push("/trips");
      router.refresh();
    } catch (error) {
      showModal(
        "error",
        "Delete Failed",
        error instanceof Error ? error.message : "Could not delete trip.",
      );
      setIsDeleting(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-4">
      {sharedLocked && (
        <p className="rounded-lg border border-stroke bg-gray-1 px-4 py-3 text-sm text-dark-5 dark:border-dark-3 dark:bg-dark-3 dark:text-dark-6">
          The trip owner manages its name, dates, status and cover. Your notes are your own.
        </p>
      )}
      <div className="rounded-lg border border-stroke bg-white p-5 dark:border-dark-3 dark:bg-dark-2">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
              Trip name
            </label>
            <TextInput
              disabled={sharedLocked}
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Trip name"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
              Base currency
            </label>
            <Select
              value={form.baseCurrency}
              onChange={(value) => setForm((prev) => ({ ...prev, baseCurrency: value }))}
              options={currencyOptions}
              disabled={hasActivity || sharedLocked}
              className="w-full"
              buttonClassName="w-full"
            />
            {hasActivity && (
              <p className="mt-1 text-xs text-dark-5 dark:text-dark-6">
                Can&apos;t change after the trip has transactions or funding.
              </p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
              Start date
            </label>
            <div className="h-11 rounded-lg border border-stroke bg-white dark:border-dark-3 dark:bg-dark-2">
              <DatePicker
                value={form.startDate}
                onChange={(value: string) =>
                  setForm((prev) => ({ ...prev, startDate: value }))
                }
                disabled={sharedLocked}
                className="h-full"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
              End date
            </label>
            <div className="h-11 rounded-lg border border-stroke bg-white dark:border-dark-3 dark:bg-dark-2">
              <DatePicker
                value={form.endDate}
                onChange={(value: string) =>
                  setForm((prev) => ({ ...prev, endDate: value }))
                }
                disabled={sharedLocked}
                className="h-full"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
              Status
            </label>
            <Select
              value={form.status}
              onChange={(value) => setForm((prev) => ({ ...prev, status: value }))}
              options={TRIP_STATUS_OPTIONS}
              disabled={sharedLocked}
              className="w-full"
              buttonClassName="w-full"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
              Cover photo
            </label>
            <div className={`flex items-center gap-2 ${sharedLocked ? "pointer-events-none opacity-50" : ""}`}>
              <TripCoverUploadButton
                onSelect={(dataUrl) =>
                  setForm((prev) => ({ ...prev, coverImageUrl: dataUrl }))
                }
              />
              {form.coverImageUrl && (
                <Button
                  variant="secondary"
                  onClick={() => setForm((prev) => ({ ...prev, coverImageUrl: "" }))}
                >
                  Use default
                </Button>
              )}
            </div>
          </div>
          <div className="md:col-span-2 h-48 overflow-hidden rounded-lg border border-stroke dark:border-dark-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={form.coverImageUrl || DEFAULT_TRIP_COVER_URL}
              alt="Trip cover preview"
              className="h-full w-full object-cover"
              onError={(event) => {
                event.currentTarget.onerror = null;
                event.currentTarget.src = DEFAULT_TRIP_COVER_URL;
              }}
            />
          </div>
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
              Notes
            </label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
              className="h-24 w-full rounded-lg border border-stroke bg-white px-3 py-2 text-sm text-dark outline-none transition focus:border-primary dark:border-dark-3 dark:bg-dark-2 dark:text-white"
              placeholder="Optional notes"
            />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="danger"
            leftIcon={<Trash2 className="h-4 w-4" />}
            onClick={() => setShowDeleteConfirm(true)}
            disabled={isSaving || isDeleting}
          >
            Delete Trip
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/trips/${trip.id}/manage/wallets`}>
            <Button variant="secondary">Wallets</Button>
          </Link>
          <Link href={`/trips/${trip.id}/manage`}>
            <Button variant="secondary">Go to Transactions</Button>
          </Link>
          <Button variant="primary" onClick={handleSave} disabled={isSaving || isDeleting}>
            {isSaving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>

      <Modal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        type="warning"
        title="Delete Trip?"
        message="This will remove the trip and all linked trip wallets, fundings, and trip transactions. This action cannot be undone."
        confirmText={isDeleting ? "Deleting..." : "Delete Trip"}
        cancelText="Cancel"
        onConfirm={() => {
          void handleDelete();
        }}
      />

      <Modal
        isOpen={modalState.isOpen}
        onClose={() => setModalState((prev) => ({ ...prev, isOpen: false }))}
        type={modalState.type}
        title={modalState.title}
        message={modalState.message}
      />
    </div>
  );
}

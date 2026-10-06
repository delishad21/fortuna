"use client";

import { useMemo, useState } from "react";
import { CalendarDays, ImagePlus, MapPinned, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { DatePicker } from "@/components/ui/DatePicker";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { TextInput } from "@/components/ui/TextInput";
import { type Trip } from "@/app/actions/trips";
import { getCurrencyOptions } from "@/lib/currencies";
import { createTrip } from "@/lib/tripMutations";

interface TripsClientProps {
  trips: Trip[];
  baseCurrency: string;
}

export const DEFAULT_TRIP_COVER_URL = "/images/trips/default-trip-cover.jpg";

export const TRIP_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "archived", label: "Archived" },
];

// Reads the picked image into a data URL, which is what the trip stores.
export function TripCoverUploadButton({
  onSelect,
}: {
  onSelect: (dataUrl: string) => void;
}) {
  const handleChange = (file?: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      onSelect(typeof reader.result === "string" ? reader.result : "");
    };
    reader.readAsDataURL(file);
  };

  return (
    <label className="h-11 rounded-lg border border-stroke dark:border-dark-3 bg-gray-1 dark:bg-dark-3 px-3 text-sm text-dark-5 dark:text-dark-6 inline-flex items-center justify-center gap-2 cursor-pointer hover:border-primary dark:hover:border-primary">
      <ImagePlus className="h-4 w-4" />
      Upload
      <input
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          handleChange(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </label>
  );
}

const emptyForm = (baseCurrency: string) => ({
  name: "",
  baseCurrency,
  status: "active",
  startDate: "",
  endDate: "",
  notes: "",
  coverImageUrl: "",
});

const formatDate = (value: string | null | undefined) => {
  if (!value) return "Ongoing";
  return new Date(value).toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

export function TripsClient({ trips, baseCurrency }: TripsClientProps) {
  const router = useRouter();
  const [items, setItems] = useState(trips);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(() => emptyForm(baseCurrency));
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currencyOptions = useMemo(() => getCurrencyOptions(), []);
  const endBeforeStart = Boolean(
    form.startDate && form.endDate && form.endDate < form.startDate,
  );

  const sortedTrips = useMemo(
    () =>
      [...items].sort(
        (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
      ),
    [items],
  );

  const handleCreate = async () => {
    if (!form.name.trim() || !form.startDate || endBeforeStart) return;
    setIsCreating(true);
    try {
      const trip = await createTrip({
        name: form.name.trim(),
        baseCurrency: form.baseCurrency,
        status: form.status,
        startDate: form.startDate,
        endDate: form.endDate || null,
        notes: form.notes || null,
        coverImageUrl: form.coverImageUrl || null,
      });
      setItems((prev) => [trip, ...prev]);
      setShowCreate(false);
      setForm(emptyForm(baseCurrency));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create trip.");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="primary"
          leftIcon={<Plus className="h-4 w-4" />}
          onClick={() => setShowCreate(true)}
        >
          New Trip
        </Button>
      </div>

      <div className="space-y-3">
        {sortedTrips.length === 0 ? (
          <div className="text-sm text-dark-5 dark:text-dark-6">
            No trips created yet.
          </div>
        ) : (
          sortedTrips.map((trip) => (
            <button
              key={trip.id}
              onClick={() => router.push(`/trips/${trip.id}`)}
              className="w-full text-left rounded-lg border border-stroke dark:border-dark-3 bg-white dark:bg-dark-2 hover:border-primary dark:hover:border-primary transition-colors p-3"
            >
              <div className="grid gap-4 md:grid-cols-[220px_1fr]">
                <div className="h-32 w-full overflow-hidden rounded-lg border border-stroke dark:border-dark-3 bg-gray-1 dark:bg-dark-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={trip.coverImageUrl || DEFAULT_TRIP_COVER_URL}
                    alt={`${trip.name} cover`}
                    className="h-full w-full object-cover"
                    onError={(event) => {
                      event.currentTarget.onerror = null;
                      event.currentTarget.src = DEFAULT_TRIP_COVER_URL;
                    }}
                  />
                </div>
                <div className="flex flex-col justify-between gap-3">
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-lg font-semibold text-dark dark:text-white">
                        {trip.name}
                      </h3>
                      <span className="rounded-full border border-stroke dark:border-dark-3 px-2 py-1 text-xs text-dark-5 dark:text-dark-6">
                        {trip.baseCurrency}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-4 text-xs text-dark-5 dark:text-dark-6">
                      <span className="inline-flex items-center gap-1">
                        <CalendarDays className="h-3.5 w-3.5" />
                        {formatDate(trip.startDate)} - {formatDate(trip.endDate)}
                      </span>
                      {trip.notes && (
                        <span className="inline-flex items-center gap-1 truncate">
                          <MapPinned className="h-3.5 w-3.5" />
                          {trip.notes}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      {showCreate && (
        <div
          className="fixed inset-0 z-50 bg-black/50 dark:bg-black/70 p-4 flex items-center justify-center"
          onClick={() => setShowCreate(false)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-2xl bg-white dark:bg-dark-2 rounded-lg border border-stroke dark:border-dark-3 shadow-card-2"
          >
            <div className="px-6 py-4 border-b border-stroke dark:border-dark-3">
              <h3 className="text-lg font-semibold text-dark dark:text-white">Create Trip</h3>
              <p className="text-sm text-dark-5 dark:text-dark-6">
                Add a trip shell first, then set wallets, funding and travel entries.
              </p>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                  Trip name
                </label>
                <TextInput
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g. Taiwan Spring 2026"
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Base currency
                  </label>
                  <Select
                    value={form.baseCurrency}
                    onChange={(value) => setForm((prev) => ({ ...prev, baseCurrency: value }))}
                    options={currencyOptions}
                    className="w-full"
                    buttonClassName="w-full"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Status
                  </label>
                  <Select
                    value={form.status}
                    onChange={(value) => setForm((prev) => ({ ...prev, status: value }))}
                    options={TRIP_STATUS_OPTIONS}
                    className="w-full"
                    buttonClassName="w-full"
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Start date
                  </label>
                  <DatePicker
                    value={form.startDate}
                    onChange={(value) => setForm((prev) => ({ ...prev, startDate: value }))}
                    triggerProps={{
                      className:
                        "rounded-lg border border-stroke dark:border-dark-3 bg-white dark:bg-dark-2 hover:border-primary dark:hover:border-primary",
                    }}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    End date (optional)
                  </label>
                  <DatePicker
                    value={form.endDate}
                    onChange={(value) => setForm((prev) => ({ ...prev, endDate: value }))}
                    triggerProps={{
                      className:
                        "rounded-lg border border-stroke dark:border-dark-3 bg-white dark:bg-dark-2 hover:border-primary dark:hover:border-primary",
                    }}
                  />
                  {endBeforeStart && (
                    <p className="text-xs text-red">End date can't be before the start date.</p>
                  )}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-[1fr_220px]">
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Notes
                  </label>
                  <TextInput
                    value={form.notes}
                    onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                    placeholder="Optional note"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-dark-5 dark:text-dark-6">
                    Cover photo
                  </label>
                  <TripCoverUploadButton
                    onSelect={(dataUrl) =>
                      setForm((prev) => ({ ...prev, coverImageUrl: dataUrl }))
                    }
                  />
                </div>
              </div>

              <div className="h-[16.25rem] overflow-hidden rounded-lg border border-stroke dark:border-dark-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={form.coverImageUrl || DEFAULT_TRIP_COVER_URL}
                  alt="Trip cover preview"
                  className="h-full w-full object-cover"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-stroke dark:border-dark-3 flex items-center justify-end gap-3">
              <Button variant="secondary" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleCreate}
                disabled={
                  isCreating || !form.name.trim() || !form.startDate || endBeforeStart
                }
              >
                {isCreating ? "Creating..." : "Create Trip"}
              </Button>
            </div>
          </div>
        </div>
      )}

      <Modal
        isOpen={Boolean(error)}
        onClose={() => setError(null)}
        type="error"
        title="Create Failed"
        message={error || ""}
      />
    </div>
  );
}

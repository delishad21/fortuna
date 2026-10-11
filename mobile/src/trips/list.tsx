import React, { useState } from "react";
import { Alert, Image, Platform, RefreshControl, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useApi, useResource } from "../api";
import {
  Banner,
  Button,
  Card,
  Choice,
  confirm,
  DateField,
  Empty,
  fmtDate,
  Heading,
  humanize,
  Input,
  notice,
  Pill,
  Screen,
  Section,
  Segmented,
  State,
  styles,
  toast,
  Txt,
} from "../ui";
import { RolePill, roleOf, TRIP_STATUSES, TripCover, tripDates } from "./common";

export function TripsScreen({ navigation }: any) {
  const { call } = useApi();
  const trips = useResource("getTrips");
  const invitations = useResource("getTripInvitations");
  const [busy, setBusy] = useState("");
  const sorted = [...(trips.data || [])].sort((a: any, b: any) =>
    String(b.startDate).localeCompare(String(a.startDate)),
  );
  const respond = async (inv: any, accept: boolean) => {
    setBusy(inv.memberId);
    try {
      if (accept) {
        const { tripId } = await call("acceptTripInvitation", inv.memberId);
        toast(`Joined ${inv.tripName}`);
        navigation.navigate("Trip", { tripId });
      } else {
        await call("declineTripInvitation", inv.memberId);
        toast("Invitation declined");
      }
      await Promise.all([invitations.reload(), trips.reload()]);
    } catch (e) {
      notice(e);
    } finally {
      setBusy("");
    }
  };
  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={trips.loading && !!trips.data}
          onRefresh={() => {
            void trips.reload();
            void invitations.reload();
          }}
        />
      }
    >
      <Heading
        title="Trips"
        subtitle="Every journey. Every currency. One place."
        right={<Button title="New trip" icon="add" compact onPress={() => navigation.navigate("TripEditor", {})} />}
      />
      {(invitations.data || []).length > 0 && (
        <Section title="Invitations">
          {invitations.data.map((inv: any) => (
            <Card key={inv.memberId} style={{ gap: 10 }}>
              <View style={{ gap: 2 }}>
                <Txt bold size={16}>
                  {inv.tripName}
                </Txt>
                <Txt muted size={13}>
                  {inv.invitedBy ? `From ${inv.invitedBy} · ` : ""}
                  {fmtDate(inv.startDate, !inv.endDate)}
                  {inv.endDate ? ` – ${fmtDate(inv.endDate)}` : ""}
                </Txt>
              </View>
              <Pill tone="purple" label={inv.role === "viewer" ? "Viewer: can only look" : "Editor: adds their own spending"} />
              <View style={styles.row}>
                <Button
                  title={busy === inv.memberId ? "Joining…" : "Accept"}
                  compact
                  icon="checkmark"
                  style={{ flex: 1 }}
                  disabled={!!busy}
                  onPress={() => void respond(inv, true)}
                />
                <Button
                  title="Decline"
                  compact
                  secondary
                  style={{ flex: 1 }}
                  disabled={!!busy}
                  onPress={() => void respond(inv, false)}
                />
              </View>
            </Card>
          ))}
        </Section>
      )}
      <State {...trips} />
      {trips.data && sorted.length === 0 && (
        <Card>
          <Empty
            icon="airplane-outline"
            title="No trips yet"
            message="Create a trip to organize wallets, spending and funding for your next journey."
            action="Plan a trip"
            onAction={() => navigation.navigate("TripEditor", {})}
          />
        </Card>
      )}
      {sorted.map((trip: any) => (
        <Card
          key={trip.id}
          onPress={() => navigation.navigate("Trip", { tripId: trip.id })}
          accessibilityLabel={trip.name}
          style={{ padding: 0, borderWidth: 0 }}
        >
          <TripCover trip={trip}>
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
              <Pill label={trip.baseCurrency} tone="purple" />
              {trip.status !== "active" && <Pill label={humanize(trip.status)} />}
              <RolePill trip={trip} />
            </View>
            <Txt bold size={22} style={{ color: "#FFFFFF" }} numberOfLines={1}>
              {trip.name}
            </Txt>
            <Txt size={13} style={{ color: "#E6E2FF" }}>
              {tripDates(trip)}
            </Txt>
          </TripCover>
        </Card>
      ))}
    </Screen>
  );
}
async function pickCover() {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: [16, 9],
    quality: 0.5,
    base64: true,
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  if (Platform.OS === "web") return asset.uri;
  if (!asset.base64) throw new Error("Couldn’t read that photo");
  if (asset.base64.length > 6 * 1024 * 1024) throw new Error("Choose a smaller photo");
  return `data:${asset.mimeType || "image/jpeg"};base64,${asset.base64}`;
}
export function TripEditorScreen({ route, navigation }: any) {
  const { call } = useApi();
  const trip = route.params?.trip;
  const user = useResource("getCurrentUser");
  const trips = useResource("getTrips");
  const entries = useResource(trip ? "getTripEntries" : "", trip?.id, { limit: 1 });
  const fundings = useResource(trip ? "getTripFundings" : "", trip?.id);
  const role = trip ? roleOf(trip) : "owner";
  const locked = !!trip?.sharing && role !== "owner";
  const hasActivity = !!trip && ((entries.data?.total || 0) > 0 || (fundings.data?.length || 0) > 0);
  const [form, setForm] = useState<any>({
    name: trip?.name || "",
    baseCurrency: trip?.baseCurrency || "",
    status: trip?.status || "active",
    startDate: String(trip?.startDate || "").slice(0, 10) || new Date().toISOString().slice(0, 10),
    endDate: String(trip?.endDate || "").slice(0, 10),
    notes: trip?.notes || "",
    coverImageUrl: trip?.coverImageUrl || "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (patch: any) => setForm((f: any) => ({ ...f, ...patch }));
  const currency = form.baseCurrency || user.data?.baseCurrency || "SGD";
  const save = async () => {
    setError("");
    if (!form.name.trim()) return setError("Give your trip a name");
    if (!form.startDate) return setError("Choose a start date");
    if (form.endDate && form.endDate < form.startDate) return setError("End date can't be before the start date");
    if (!/^[A-Z]{3}$/.test(currency)) return setError("Use a three-letter currency code, such as SGD");
    setBusy(true);
    try {
      if (trip) {
        await call(
          "updateTrip",
          trip.id,
          locked
            ? { notes: form.notes.trim() || null }
            : {
                name: form.name.trim(),
                ...(currency !== trip.baseCurrency ? { baseCurrency: currency } : {}),
                coverImageUrl: form.coverImageUrl.trim() || null,
                startDate: form.startDate,
                endDate: form.endDate || null,
                status: form.status,
                notes: form.notes.trim() || null,
              },
        );
        toast("Trip saved");
        navigation.goBack();
        return;
      }
      const hadTrips = (trips.data || []).length > 0;
      const created = await call("createTrip", {
        name: form.name.trim(),
        baseCurrency: currency,
        status: form.status,
        startDate: form.startDate,
        endDate: form.endDate || null,
        notes: form.notes.trim() || null,
        coverImageUrl: form.coverImageUrl.trim() || null,
      });
      navigation.replace("Trip", { tripId: created.id });
      if (hadTrips) {
        const sources = await call("getCarryOverSources", created.id).catch(() => []);
        if (sources?.length) {
          const lines = sources
            .slice(0, 3)
            .map((s: any) => `${s.trip.name}: ${s.candidates.map((c: any) => `${c.name} ${c.currency} ${Number(c.balance).toFixed(2)}`).join(", ")}`)
            .join("\n");
          const go = () => navigation.navigate("CarryOver", { tripId: created.id, sourceTripId: sources[0].trip.id });
          if (Platform.OS === "web") {
            if (window.confirm(`Bring leftover money?\n\n${lines}`)) go();
          } else
            Alert.alert("Bring leftover money?", `Your other trips still hold money:\n\n${lines}`, [
              { text: "Not now", style: "cancel" },
              { text: "Carry over", onPress: go },
            ]);
        }
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen
      footer={<Button title={trip ? "Save trip" : "Create trip"} icon="checkmark" loading={busy} disabled={busy} onPress={() => void save()} />}
    >
      <Heading title={trip ? "Trip details" : "Where to next?"} subtitle={trip ? trip.name : "Set up wallets and spending once you're in."} />
      {locked && (
        <Banner
          tone="amber"
          icon="lock-closed-outline"
          message="The trip owner manages its name, dates, status and cover. Your notes are your own."
        />
      )}
      <TripCover trip={{ coverImageUrl: form.coverImageUrl }} height={150}>
        {!locked && (
          <View style={[styles.row, { gap: 8 }]}>
            <Button
              title="Choose photo"
              compact
              icon="image-outline"
              onPress={() =>
                void pickCover()
                  .then((url) => url && set({ coverImageUrl: url }))
                  .catch(notice)
              }
            />
            {!!form.coverImageUrl && <Button title="Use default" compact secondary onPress={() => set({ coverImageUrl: "" })} />}
          </View>
        )}
      </TripCover>
      <Card>
        <Input label="Trip name" value={form.name} editable={!locked} onChangeText={(name: string) => set({ name })} placeholder="Tokyo in spring" />
        <Input
          label="Base currency"
          value={currency}
          editable={!locked && !hasActivity}
          autoCapitalize="characters"
          maxLength={3}
          hint={hasActivity ? "Can't change after the trip has transactions or funding." : "Every amount is valued in this currency."}
          onChangeText={(v: string) => set({ baseCurrency: v.toUpperCase() })}
        />
        {locked ? (
          <Txt muted>{tripDates({ startDate: form.startDate, endDate: form.endDate })}</Txt>
        ) : (
          <>
            <View style={[styles.row, { alignItems: "flex-start" }]}>
              <View style={{ flex: 1 }}>
                <DateField label="Start" value={form.startDate} onChange={(startDate) => set({ startDate })} />
              </View>
              <View style={{ flex: 1 }}>
                <DateField label="End" value={form.endDate} onChange={(endDate) => set({ endDate })} />
              </View>
            </View>
            <Section title="Status">
              <Segmented
                values={TRIP_STATUSES}
                labels={{ active: "Active", completed: "Completed", archived: "Archived" }}
                value={form.status}
                onChange={(status) => set({ status })}
              />
            </Section>
          </>
        )}
        <Input label="Notes" value={form.notes} multiline onChangeText={(notes: string) => set({ notes })} placeholder="Anything to remember" />
        {!locked && (
          <Input
            label="Cover image URL"
            value={form.coverImageUrl.startsWith("data:") ? "Uploaded photo" : form.coverImageUrl}
            editable={!form.coverImageUrl.startsWith("data:")}
            autoCapitalize="none"
            placeholder="https://…"
            onChangeText={(coverImageUrl: string) => set({ coverImageUrl })}
          />
        )}
      </Card>
      {!!error && <Banner tone="red" icon="alert-circle-outline" message={error} />}
      {trip && (
        <Button
          title="Delete trip"
          danger
          secondary
          icon="trash-outline"
          onPress={() =>
            confirm(
              "Delete this trip?",
              "This removes the trip and its wallets, entries and funding.",
              async () => {
                await call("deleteTrip", trip.id);
                toast("Trip deleted");
                navigation.navigate("Main", { screen: "Trips" });
              },
              "Delete",
            )
          }
        />
      )}
    </Screen>
  );
}

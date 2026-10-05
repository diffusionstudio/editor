/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { useSearchParams } from "@solidjs/router";
import { Show, createEffect, createSignal } from "solid-js";
import { toast } from "somoto";
import type { EmailPreferences } from "@diffusionstudio/api-contract";

import { useAvatar } from "@/hooks/use-avatar";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  Switch,
  SwitchControl,
  SwitchInput,
  SwitchLabel,
  SwitchThumb,
} from "@/components/ui/switch";
import { TextField, TextFieldInput, TextFieldLabel } from "@/components/ui/text-field";
import { useAuth } from "@/context/auth";
import { supabase } from "@/lib/supabase";
import { api } from "@/lib/api";

import {
  DashboardDividedStack,
  DashboardFormModal,
  DashboardFreePlanDetails,
  DashboardInfoActionRow,
  DashboardPaidPlanDetails,
  DashboardPlanSummaryCard,
  DashboardScrollView,
  DashboardSurfaceSection,
  DashboardTitledSection,
  DashboardSurfaceCard,
} from "./shared";
import { cropAndResizeAvatar } from "./utils";
import { Separator } from "@/components/ui/separator";

type AccountRowStatusTone = "muted" | "primary";

type AccountPreferenceRow = {
  title: string;
  description: string;
  checked: boolean;
  onChange(checked: boolean): void;
};

type DashboardAccountStatusProps = {
  value: string;
  tone?: AccountRowStatusTone;
};

function DashboardAccountStatus(props: DashboardAccountStatusProps) {
  return (
    <span
      class="truncate text-xs"
      classList={{
        "text-primary": props.tone === "primary",
        "text-muted-foreground": props.tone !== "primary",
      }}
    >
      {props.value}
    </span>
  );
}

function DashboardAccountInfoRow(props: {
  icon: string;
  label: string;
  description?: string;
  status?: string;
  statusTone?: AccountRowStatusTone;
  actionLabel: string;
  onClick?(): void;
}) {
  const statusText = () => props.status;

  return (
    <DashboardInfoActionRow
      leading={
        <Icon
          name={props.icon}
          class="size-6 text-foreground"
        />
      }
      title={props.label}
      titleContent={
        <Show
          when={props.status}
          fallback={
            <p class="truncate text-foreground text-xs">
              {props.label}
            </p>
          }
        >
          <div class="flex min-w-0 items-center gap-1">
            <p class="truncate text-foreground text-xs">
              {props.label}
            </p>
            <span class="text-muted-foreground text-xs">
              {"\u00B7"}
            </span>
            <DashboardAccountStatus
              value={statusText() ?? ""}
              tone={props.statusTone}
            />
          </div>
        </Show>
      }
      description={props.description ? <p>{props.description}</p> : undefined}
      action={
        <Button variant="secondary" onClick={props.onClick}>
          {props.actionLabel}
        </Button>
      }
    />
  );
}

function DashboardAccountPreferenceRow(props: AccountPreferenceRow) {
  return (
    <Switch
      checked={props.checked}
      onChange={props.onChange}
      class="flex items-center gap-4"
    >
      <SwitchLabel class="min-w-0 flex-1 cursor-pointer pr-4 text-xs font-normal">
        <span class="block text-foreground">
          {props.title}
        </span>
        <span class="mt-1 block text-muted-foreground">
          {props.description}
        </span>
      </SwitchLabel>
      <SwitchInput aria-label={`Email preference: ${props.title}`} />
      <SwitchControl variant="compact">
        <SwitchThumb variant="compact" />
      </SwitchControl>
    </Switch>
  );
}

function DashboardAccountPersonalDetailsSection() {
  const auth = useAuth();
  const [firstName, setFirstName] = createSignal(
    (auth.user()?.user_metadata?.first_name as string) ?? ""
  );
  const [lastName, setLastName] = createSignal(
    (auth.user()?.user_metadata?.last_name as string) ?? ""
  );
  const [saving, setSaving] = createSignal(false);
  const [uploading, setUploading] = createSignal(false);
  const [localPreview, setLocalPreview] = createSignal<string | null>(null);

  let fileInputRef!: HTMLInputElement;

  const avatarUrl = useAvatar();
  const displayUrl = () => localPreview() ?? avatarUrl();

  const initial = () => {
    const name = auth.user()?.user_metadata?.full_name || auth.user()?.email || "U";
    return (name as string).charAt(0).toUpperCase();
  };

  const handleAvatarUpload = async (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0 || !supabase) return;

    const file = input.files[0]!;
    setUploading(true);

    try {
      const blob = await cropAndResizeAvatar(file);

      // Optimistic preview
      const prev = localPreview();
      if (prev) URL.revokeObjectURL(prev);
      setLocalPreview(URL.createObjectURL(blob));

      const userId = auth.user()?.id;
      if (!userId) throw new Error("Not authenticated");

      const filePath = `${userId}/${Date.now()}.webp`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, blob, { contentType: "image/webp", upsert: false });

      if (uploadError) throw uploadError;

      const { error: updateError } = await supabase.auth.updateUser({
        data: { avatar_url: filePath },
      });

      if (updateError) throw updateError;

      await auth.refreshSession();
      toast.success("Profile photo updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      input.value = "";
    }
  };

  const handleSave = async () => {
    if (!supabase) return;
    setSaving(true);

    const { error } = await supabase.auth.updateUser({
      data: {
        first_name: firstName(),
        last_name: lastName(),
        full_name: [firstName(), lastName()].filter(Boolean).join(" "),
      },
    });

    setSaving(false);

    if (error) {
      toast.error(error.message);
    } else {
      await auth.refreshSession();
      toast.success("Profile updated");
    }
  };

  return (
    <DashboardSurfaceSection title="Personal details">
      <div class="flex flex-col gap-2">
        <p class="text-muted-foreground text-xs">
          Profile photo
        </p>

        <div class="flex items-center gap-4">
          <Show
            when={displayUrl()}
            fallback={
              <div class="grid size-16 place-items-center rounded-md bg-input text-lg text-foreground">
                {initial()}
              </div>
            }
          >
            {(url) => (
              <img
                src={url()}
                alt=""
                class="size-16 rounded-md object-cover"
              />
            )}
          </Show>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            class="hidden"
            onChange={handleAvatarUpload}
          />
          <Button
            variant="secondary"
            disabled={uploading()}
            onClick={() => fileInputRef.click()}
            class="gap-1"
          >
            Change image
            <Show when={uploading()}>
              <Icon name="spinner-loader" class="size-6 animate-spin" />
            </Show>
          </Button>
        </div>
      </div>

      <Separator />

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField>
          <TextFieldLabel uiSize="compact" class="text-muted-foreground">
            First name
          </TextFieldLabel>
          <TextFieldInput
            uiSize="compact"
            value={firstName()}
            onInput={(event) => setFirstName(event.currentTarget.value)}
            onKeyDown={(event) => event.stopPropagation()}
            onKeyUp={(event) => event.stopPropagation()}
          />
        </TextField>

        <TextField>
          <TextFieldLabel uiSize="compact" class="text-muted-foreground">
            Last name
          </TextFieldLabel>
          <TextFieldInput
            uiSize="compact"
            value={lastName()}
            onInput={(event) => setLastName(event.currentTarget.value)}
            onKeyDown={(event) => event.stopPropagation()}
            onKeyUp={(event) => event.stopPropagation()}
          />
        </TextField>
      </div>

      <Button
        variant="secondary"
        class="self-start gap-1"
        disabled={saving()}
        onClick={handleSave}
      >
        Save changes
        <Show when={saving()}>
          <Icon name="spinner-loader" class="size-6 animate-spin" />
        </Show>
      </Button>
    </DashboardSurfaceSection>
  );
}

function DashboardAccountLoginSecuritySection() {
  const auth = useAuth();
  const email = () => auth.user()?.email ?? "";
  const emailConfirmed = () => !!auth.user()?.email_confirmed_at;

  const [modalOpen, setModalOpen] = createSignal(false);
  const [newEmail, setNewEmail] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);

  const handleChangeEmail = async () => {
    if (!supabase) return;

    const trimmed = newEmail().trim();
    if (!trimmed) return;

    setSubmitting(true);

    const { error } = await supabase.auth.updateUser({ email: trimmed });

    setSubmitting(false);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Confirmation link sent to your new email address");
      setModalOpen(false);
      setNewEmail("");
    }
  };

  return (
    <DashboardSurfaceSection title="Login & security">
      <DashboardDividedStack>
        <DashboardAccountInfoRow
          icon="email"
          label="Email address"
          status={emailConfirmed() ? "Verified" : "Unverified"}
          statusTone={emailConfirmed() ? "muted" : "primary"}
          description={email()}
          actionLabel="Change email"
          onClick={() => setModalOpen(true)}
        />
      </DashboardDividedStack>

      <DashboardFormModal
        open={modalOpen()}
        title="Change email"
        onClose={() => setModalOpen(false)}
        footer={
          <Button
            disabled={submitting() || !newEmail().trim()}
            onClick={() => void handleChangeEmail()}
          >
            {submitting() ? "Sending..." : "Send confirmation"}
          </Button>
        }
      >
        <div class="flex flex-col gap-3 px-2">
          <p class="text-muted-foreground text-xs">
            We'll send a confirmation link to your new email address.
          </p>
          <TextField>
            <TextFieldLabel uiSize="compact" class="text-muted-foreground">
              New email address
            </TextFieldLabel>
            <TextFieldInput
              uiSize="compact"
              type="email"
              value={newEmail()}
              onInput={(e) => setNewEmail(e.currentTarget.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") void handleChangeEmail();
              }}
              onKeyUp={(e) => e.stopPropagation()}
            />
          </TextField>
        </div>
      </DashboardFormModal>
    </DashboardSurfaceSection>
  );
}

function DashboardAccountActiveSessionsSection() {
  const auth = useAuth();

  return (
    <DashboardSurfaceSection title="Active sessions">
      <DashboardAccountInfoRow
        icon="mac-device"
        label="Current session"
        status="Active"
        statusTone="primary"
        actionLabel="Log out"
        onClick={auth.signOut}
      />
    </DashboardSurfaceSection>
  );
}

function DashboardAccountLinkedAccountsSection() {
  const auth = useAuth();

  const identityCount = () => auth.user()?.identities?.length ?? 0;

  const isProviderLinked = (provider: string) => {
    return auth.user()?.identities?.some((i) => i.provider === provider) ?? false;
  };

  const isLastIdentity = (provider: string) => {
    return isProviderLinked(provider) && identityCount() <= 1;
  };

  const handleLink = async (provider: "google" | "apple" | "github") => {
    if (!supabase) return;

    const { error } = await supabase.auth.linkIdentity({
      provider,
      options: {
        redirectTo: window.location.origin,
      },
    });

    if (error) {
      toast.error(error.message);
    }
  };

  const handleUnlink = async (provider: string) => {
    if (!supabase) return;

    if (isLastIdentity(provider)) {
      toast.error("You can't disconnect your only login method. Link another account first.");
      return;
    }

    const identity = auth.user()?.identities?.find((i) => i.provider === provider);
    if (!identity) return;

    const { error } = await supabase.auth.unlinkIdentity(identity);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success(`${provider.charAt(0).toUpperCase() + provider.slice(1)} disconnected`);
    }
  };

  const handleGoogleLink = async () => {
    if (isProviderLinked("google")) {
      handleUnlink("google");
    } else {
      handleLink("google");
    }
  };

  const handleGitHubLink = async () => {
    if (isProviderLinked("github")) {
      handleUnlink("github");
    } else {
      handleLink("github");
    }
  };

  return (
    <DashboardSurfaceSection title="Linked accounts">
      <DashboardDividedStack>
        <DashboardAccountInfoRow
          icon="social.google"
          label="Google"
          status={isProviderLinked("google") ? "Connected" : undefined}
          actionLabel={isProviderLinked("google") ? "Disconnect" : "Connect"}
          onClick={handleGoogleLink}
        />
        <DashboardAccountInfoRow
          icon="social.github"
          label="GitHub"
          status={isProviderLinked("github") ? "Connected" : undefined}
          actionLabel={isProviderLinked("github") ? "Disconnect" : "Connect"}
          onClick={handleGitHubLink}
        />
      </DashboardDividedStack>
    </DashboardSurfaceSection>
  );
}

function DashboardAccountFreePlanCard() {
  const [, setParams] = useSearchParams();

  return (
    <DashboardSurfaceCard class="flex flex-col gap-4 md:flex-row md:items-center">
      <DashboardFreePlanDetails />

      <Button
        class="gap-0 pl-0 pr-2"
        onClick={() => setParams({ dashboard: "billing" }, { replace: true })}
      >
        <span class="grid h-7 w-6 place-items-center overflow-clip">
          <Icon name="upgrade" class="size-6" />
        </span>
        Upgrade
      </Button>
    </DashboardSurfaceCard>
  );
}

function DashboardAccountPlanSection() {
  const auth = useAuth();
  const [, setParams] = useSearchParams();

  return (
    <DashboardTitledSection title="Plan">
      <Show
        when={auth.isSubscribed()}
        fallback={<DashboardAccountFreePlanCard />}
      >
        <DashboardPlanSummaryCard
          action={
            <Button
              variant="secondary"
              onClick={() => setParams({ dashboard: "billing" }, { replace: true })}
            >
              View details
            </Button>
          }
        >
          <DashboardPaidPlanDetails />
        </DashboardPlanSummaryCard>
      </Show>
    </DashboardTitledSection>
  );
}

type EmailPreference = keyof EmailPreferences;

function DashboardAccountEmailPreferencesSection() {
  const auth = useAuth();
  const [optimistic, setOptimistic] =
    createSignal<Partial<EmailPreferences>>({});

  const serverValue = (preference: EmailPreference) =>
    preference === "productUpdates"
      ? auth.productUpdatesEnabled()
      : auth.marketingAnnouncementsEnabled();

  const value = (preference: EmailPreference) =>
    optimistic()[preference] ?? serverValue(preference);

  // Clear optimistic overrides once the refetched account catches up.
  createEffect(() => {
    const current = optimistic();
    let next = current;
    for (const preference of ["productUpdates", "marketingAnnouncements"] as const) {
      if (preference in current && current[preference] === serverValue(preference)) {
        if (next === current) next = { ...current };
        delete next[preference];
      }
    }
    if (next !== current) setOptimistic(next);
  });

  const handleChange = (preference: EmailPreference) => async (v: boolean) => {
    setOptimistic({ ...optimistic(), [preference]: v });
    try {
      await api.account.updateEmailPreferences.mutate({ [preference]: v });
      auth.refreshAccount();
    } catch (err) {
      const next = { ...optimistic() };
      delete next[preference];
      setOptimistic(next);
      const message = err instanceof Error ? err.message : "Failed to update preference";
      toast.error("Action failed", { description: message });
    }
  };

  return (
    <DashboardSurfaceSection title="Email preferences">
      <DashboardDividedStack>
        <DashboardAccountPreferenceRow
          title="Product updates"
          description="Feature updates and important changes."
          checked={value("productUpdates")}
          onChange={handleChange("productUpdates")}
        />
        <DashboardAccountPreferenceRow
          title="Marketing & announcements"
          description="Product news and announcements."
          checked={value("marketingAnnouncements")}
          onChange={handleChange("marketingAnnouncements")}
        />
      </DashboardDividedStack>
    </DashboardSurfaceSection>
  );
}

function DashboardAccountDangerZoneSection() {
  const auth = useAuth();
  const [confirmOpen, setConfirmOpen] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);

  const handleDelete = async () => {
    setDeleting(true);
    const { error } = await auth.deleteAccount();
    setDeleting(false);

    if (error) {
      toast.error(error);
    } else {
      setConfirmOpen(false);
      toast.success("Your account has been deleted.");
    }
  };

  return (
    <DashboardSurfaceSection title="Danger zone">
      <DashboardInfoActionRow
        title="Permanently delete your account and all associated data."
        action={
          <Button
            variant="destructive"
            onClick={() => setConfirmOpen(true)}
          >
            Delete account
          </Button>
        }
      />

      <AlertDialog open={confirmOpen()} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete account</AlertDialogTitle>
            <AlertDialogDescription>
              This action is permanent and cannot be undone. All your projects,
              data, and settings will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="secondary"
              onClick={() => setConfirmOpen(false)}
              disabled={deleting()}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleting()}
              onClick={handleDelete}
            >
              {deleting() ? "Deleting..." : "Yes, delete my account"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardSurfaceSection>
  );
}

export function DashboardAccountView() {
  return (
    <DashboardScrollView>
      <DashboardAccountPersonalDetailsSection />
      <DashboardAccountLoginSecuritySection />
      <DashboardAccountActiveSessionsSection />
      <DashboardAccountLinkedAccountsSection />
      <DashboardAccountPlanSection />
      <DashboardAccountEmailPreferencesSection />
      <DashboardAccountDangerZoneSection />
    </DashboardScrollView>
  );
}

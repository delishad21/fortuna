-- How the user mainly works: "daily" (an assistant logs spending as it
-- happens) or "statements" (monthly statement uploads). It only changes what
-- the apps show first. NULL means not chosen yet: the apps treat users with
-- assistant entries as daily trackers and everyone else as statement uploaders.
ALTER TABLE "user_settings" ADD COLUMN "workflow_mode" TEXT;

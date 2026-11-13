CREATE TABLE `prompt_version` (
	`id` text PRIMARY KEY NOT NULL,
	`task` text NOT NULL,
	`version` integer NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE INDEX `prompt_version_task` ON `prompt_version` (`task`,`version`);--> statement-breakpoint
ALTER TABLE `generation_job` ADD `prompt_version` integer;--> statement-breakpoint
ALTER TABLE `prompt_template` ADD `version` integer DEFAULT 1 NOT NULL;
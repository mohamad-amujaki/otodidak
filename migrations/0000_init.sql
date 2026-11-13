CREATE TABLE `ai_model` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`model_name` text NOT NULL,
	`task` text NOT NULL,
	`active` integer NOT NULL,
	`max_output_tokens` integer NOT NULL,
	`timeout_ms` integer NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `ai_provider`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ai_provider` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`auth_kind` text NOT NULL,
	`secret_name` text,
	`active` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `app_config` (
	`id` text PRIMARY KEY NOT NULL,
	`max_chapters` integer NOT NULL,
	`max_lessons_per_chapter` integer NOT NULL,
	`quiz_question_count` integer NOT NULL,
	`quiz_pass_percent` integer NOT NULL,
	`cost_roadmap` integer NOT NULL,
	`cost_lesson` integer NOT NULL,
	`cost_quiz` integer NOT NULL,
	`signup_credits` integer NOT NULL,
	`lesson_minute_label` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chapter` (
	`id` text PRIMARY KEY NOT NULL,
	`path_id` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`quiz_status` text NOT NULL,
	FOREIGN KEY (`path_id`) REFERENCES `path`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `chapter_path_position` ON `chapter` (`path_id`,`position`);--> statement-breakpoint
CREATE TABLE `credit_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`amount` integer NOT NULL,
	`reason` text NOT NULL,
	`ref_type` text,
	`ref_id` text,
	`idempotency_key` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `credit_ledger_user_created` ON `credit_ledger` (`user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `credit_ledger_idempotency` ON `credit_ledger` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `credit_order` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`pack_id` text NOT NULL,
	`order_id` text NOT NULL,
	`amount_idr` integer NOT NULL,
	`credits` integer NOT NULL,
	`status` text NOT NULL,
	`sumopod_payment_id` text,
	`payment_link_url` text,
	`created_at` text NOT NULL,
	`paid_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credit_order_order_id` ON `credit_order` (`order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `credit_order_one_pending` ON `credit_order` (`user_id`) WHERE status = 'pending';--> statement-breakpoint
CREATE TABLE `credit_pack` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`credits` integer NOT NULL,
	`price_idr` integer NOT NULL,
	`active` integer NOT NULL,
	`sort` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `generation_job` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`ref_id` text NOT NULL,
	`status` text NOT NULL,
	`error_code` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `generation_job_user_status` ON `generation_job` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `generation_job_ref_kind` ON `generation_job` (`ref_id`,`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `generation_job_one_active` ON `generation_job` (`user_id`) WHERE status in ('queued', 'running');--> statement-breakpoint
CREATE TABLE `lesson_claim` (
	`id` text PRIMARY KEY NOT NULL,
	`lesson_id` text NOT NULL,
	`quote` text NOT NULL,
	`unsourced` integer NOT NULL,
	`source_id` text,
	FOREIGN KEY (`lesson_id`) REFERENCES `lesson`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `lesson_source` (
	`id` text PRIMARY KEY NOT NULL,
	`lesson_id` text NOT NULL,
	`kind` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`lesson_id`) REFERENCES `lesson`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `lesson` (
	`id` text PRIMARY KEY NOT NULL,
	`chapter_id` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`objective` text NOT NULL,
	`body` text,
	`status` text NOT NULL,
	`completed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapter`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `lesson_chapter_position` ON `lesson` (`chapter_id`,`position`);--> statement-breakpoint
CREATE TABLE `path` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`topic` text NOT NULL,
	`status` text NOT NULL,
	`is_active` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `path_user_active` ON `path` (`user_id`,`is_active`);--> statement-breakpoint
CREATE UNIQUE INDEX `path_one_active` ON `path` (`user_id`) WHERE is_active = 1;--> statement-breakpoint
CREATE TABLE `payment_event` (
	`svix_id` text PRIMARY KEY NOT NULL,
	`order_id` text,
	`event_type` text NOT NULL,
	`payment_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `prompt_template` (
	`task` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text
);
--> statement-breakpoint
CREATE TABLE `quiz_attempt` (
	`id` text PRIMARY KEY NOT NULL,
	`quiz_id` text NOT NULL,
	`user_id` text NOT NULL,
	`score_percent` integer NOT NULL,
	`answers_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`quiz_id`) REFERENCES `quiz`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `quiz_question` (
	`id` text PRIMARY KEY NOT NULL,
	`quiz_id` text NOT NULL,
	`position` integer NOT NULL,
	`stem` text NOT NULL,
	`choices_json` text NOT NULL,
	`correct_index` integer NOT NULL,
	`explanation` text NOT NULL,
	FOREIGN KEY (`quiz_id`) REFERENCES `quiz`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `quiz` (
	`id` text PRIMARY KEY NOT NULL,
	`chapter_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapter`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `source_provider` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`secret_name` text NOT NULL,
	`active` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`clerk_user_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`streak_enabled` integer DEFAULT 1 NOT NULL,
	`streak_count` integer DEFAULT 0 NOT NULL,
	`streak_last_date` text,
	`streak_freeze_week` text,
	`deletion_requested_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_clerk_user_id` ON `user` (`clerk_user_id`);
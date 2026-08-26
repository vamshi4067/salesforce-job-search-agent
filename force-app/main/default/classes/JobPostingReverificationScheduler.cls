global with sharing class JobPostingReverificationScheduler implements Schedulable {
    global void execute(SchedulableContext context) {
        Database.executeBatch(new JobPostingReverificationBatch(), 20);
    }

    public static String scheduleDaily(Integer hour) {
        if (hour == null || hour < 0 || hour > 23) {
            throw new IllegalArgumentException('Hour must be between 0 and 23.');
        }
        String cron = '0 0 ' + hour + ' * * ?';
        return System.schedule('Daily Job Posting Reverification', cron,
            new JobPostingReverificationScheduler());
    }
}

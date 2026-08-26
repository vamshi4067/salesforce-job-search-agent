@IsTest
private class JobPostingReverificationBatchTest {
    private class PostingMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest request) {
            HttpResponse response = new HttpResponse();
            if (request.getEndpoint().contains('/closed')) {
                response.setStatusCode(410);
                response.setBody('Gone');
            } else if (request.getEndpoint().contains('/blocked')) {
                response.setStatusCode(403);
                response.setBody('Forbidden');
            } else {
                response.setStatusCode(200);
                response.setBody('<html><body>Apply now</body></html>');
            }
            return response;
        }
    }

    private static Job_Application__c makeJob(String suffix, String status) {
        return new Job_Application__c(
            Company__c = 'Test Company',
            Job_Title__c = 'Salesforce Developer',
            Posting_URL__c = 'https://example.com/' + suffix,
            Posting_Key__c = suffix,
            Status__c = status,
            Verified_Open__c = true
        );
    }

    @IsTest
    static void rechecksOpenClosedAndBlockedPostings() {
        insert new List<Job_Application__c>{
            makeJob('open', 'Discovered'),
            makeJob('closed', 'Reviewing'),
            makeJob('blocked', 'Applied')
        };
        Test.setMock(HttpCalloutMock.class, new PostingMock());

        Test.startTest();
        Database.executeBatch(new JobPostingReverificationBatch(), 20);
        Test.stopTest();

        Map<String, Job_Application__c> jobs = new Map<String, Job_Application__c>();
        for (Job_Application__c job : [
            SELECT Posting_Key__c, Status__c, Verified_Open__c, Last_Verified__c
            FROM Job_Application__c
        ]) {
            jobs.put(job.Posting_Key__c, job);
        }
        System.assertEquals(true, jobs.get('open').Verified_Open__c);
        System.assertNotEquals(null, jobs.get('open').Last_Verified__c);
        System.assertEquals(false, jobs.get('closed').Verified_Open__c);
        System.assertEquals('Closed', jobs.get('closed').Status__c);
        System.assertEquals(true, jobs.get('blocked').Verified_Open__c);
        System.assertEquals('Applied', jobs.get('blocked').Status__c);
        System.assertEquals(null, jobs.get('blocked').Last_Verified__c);
    }

    @IsTest
    static void schedulerStartsBatch() {
        Test.setMock(HttpCalloutMock.class, new PostingMock());
        Test.startTest();
        String jobId = JobPostingReverificationScheduler.scheduleDaily(7);
        Test.stopTest();
        System.assertNotEquals(null, jobId);
    }

    @IsTest
    static void rejectsInvalidScheduleHour() {
        try {
            JobPostingReverificationScheduler.scheduleDaily(24);
            System.assert(false, 'Expected invalid hour to fail.');
        } catch (IllegalArgumentException expected) {
            System.assert(expected.getMessage().contains('between 0 and 23'));
        }
    }
}

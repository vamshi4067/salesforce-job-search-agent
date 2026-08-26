global with sharing class JobPostingReverificationBatch
        implements Database.Batchable<SObject>, Database.AllowsCallouts, Database.Stateful {
    global Integer checkedCount = 0;
    global Integer closedCount = 0;

    global Database.QueryLocator start(Database.BatchableContext context) {
        return Database.getQueryLocator([
            SELECT Id, Posting_URL__c, Status__c, Verified_Open__c
            FROM Job_Application__c
            WHERE Verified_Open__c = true
              AND Posting_URL__c != null
              AND Status__c != 'Rejected'
              AND Status__c != 'Closed'
        ]);
    }

    global void execute(Database.BatchableContext context, List<Job_Application__c> scope) {
        List<Job_Application__c> updates = new List<Job_Application__c>();
        for (Job_Application__c job : scope) {
            VerificationResult result = verify(job.Posting_URL__c);
            if (!result.definitive) {
                continue;
            }

            checkedCount++;
            Job_Application__c change = new Job_Application__c(
                Id = job.Id,
                Verified_Open__c = result.isOpen,
                Last_Verified__c = System.now()
            );
            if (!result.isOpen) {
                closedCount++;
                if (job.Status__c == 'Discovered' || job.Status__c == 'Reviewing') {
                    change.Status__c = 'Closed';
                }
            }
            updates.add(change);
        }
        if (!updates.isEmpty()) {
            Database.update(updates, false);
        }
    }

    global void finish(Database.BatchableContext context) {
        System.debug(LoggingLevel.INFO,
            'Job posting reverification completed. Checked=' + checkedCount + ', closed=' + closedCount);
    }

    @TestVisible
    private static VerificationResult verify(String url) {
        VerificationResult result = new VerificationResult();
        try {
            HttpRequest request = new HttpRequest();
            request.setEndpoint(url);
            request.setMethod('GET');
            request.setTimeout(10000);
            request.setHeader('User-Agent', 'Mozilla/5.0 (compatible; SalesforceJobTracker/1.0)');
            HttpResponse response = new Http().send(request);
            Integer code = response.getStatusCode();

            if (code == 404 || code == 410) {
                result.definitive = true;
                result.isOpen = false;
                return result;
            }
            if (code < 200 || code >= 300) {
                return result;
            }

            String body = response.getBody() == null ? '' : response.getBody().toLowerCase();
            List<String> closedSignals = new List<String>{
                'no longer accepting applications',
                'this job is no longer available',
                'this position has been filled',
                'this position is no longer available',
                'job posting has expired',
                'the job you are looking for is no longer open'
            };
            result.definitive = true;
            result.isOpen = true;
            for (String signal : closedSignals) {
                if (body.contains(signal)) {
                    result.isOpen = false;
                    break;
                }
            }
        } catch (Exception error) {
            System.debug(LoggingLevel.WARN, 'Could not verify job URL: ' + error.getMessage());
        }
        return result;
    }

    @TestVisible
    private class VerificationResult {
        Boolean definitive = false;
        Boolean isOpen = false;
    }
}

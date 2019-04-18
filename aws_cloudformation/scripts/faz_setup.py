#!/usr/bin/env python
import sys
import subprocess
import json
import time

def byteify(input):
    if isinstance(input, dict):
        return {byteify(key): byteify(value)
                for key, value in input.iteritems()}
    elif isinstance(input, list):
        return [byteify(element) for element in input]
    elif isinstance(input, unicode):
        return input.encode('utf-8')
    else:
        return input

# First need to enable JSONRPC on FAZ
#config system admin user
#  edit admin
#  set rpc-permit read-write
#  end
#end

FAZ_IP = "10.100.88.2"
print "Setting up FAZ " + FAZ_IP

# Retrieve token string from login request

data={
"method": "exec",
    "params": [
        {
            "url": "/sys/login/user",
            "data": {
                "user": "admin",
                "passwd": "fortipocadmin"
            }
        }
    ],
    "id": 1
}

cmd_curl = 'curl -m 5 --silent -H "Accept: application/json" -X POST "http://'+ FAZ_IP + '/jsonrpc" -d "' + str(data) + '"'

# Check if FAZ is up before continue
FAZ_UP = False
while FAZ_UP is False:
    print "Attemp to login to FAZ via jsonrpc"
    print(cmd_curl)
    try:
        output = subprocess.check_output(cmd_curl, shell=True)
    except subprocess.CalledProcessError as e:
        print "Failed to login to FAZ " + FAZ_IP
        time.sleep(60)
        continue
    try:
        token = json.loads(output)['session']
        print "Obtained logging token " + token
    except:
        print "Failed to obtain login token"
        time.sleep(60)
        continue
    FAZ_UP = True

# Wait for a bit for FAZ to be fully up
time.sleep(60)

# Update FAZ logging quota
print "Updating FAZ log quota"

data = {
    "method": "update",
    "params": [{
        "url": "dvmdb/adom",
        'data': [{
            'name': 'root',
            'log_db_retention_hours': 14400,
            'log_disk_quota_split_ratio': 70,
            'restricted_prds': 0,
            'mode': 1,
            'state': 1,
            'flags': 65536,
            'log_disk_quota': 10000,
            'mr': 2,
            'log_file_retention_hours': 82550,
            'mig_mr': 0,
            'log_disk_quota_alert_thres': 90,
            'os_ver': 5,
            'desc': ''
        }]
    }],
    "id": 1,
    "session": str(token)
}

# Need to remove any double quote " in the curl command
cmd_curl = 'curl --silent -H "Accept: application/json" -X POST "http://'+ FAZ_IP + '/jsonrpc" -d "' + str(data).replace('"', "'") + '"'
#print(cmd_curl)

try:
    output = subprocess.check_output(cmd_curl, shell=True)
    print "Updated FAZ log quota"
except:
    print "Failed to update FAZ quota"
    e = sys.exc_info()[0]
    print e
    print output


#Get devices
d_param={
"url": "/dvmdb/device",
}
params = []
params.append(d_param)
req = {
"method": "get",
"id": "1",
"params": params,
"jsonrpc": "1.0",
"session": str(token)
}
cmd_curl = 'curl --silent -H "Accept: application/json" -X POST "http://'+ FAZ_IP + '/jsonrpc" -d "' + str(req) + '"'
try:
        output = subprocess.check_output(cmd_curl, shell=True)
        res = json.loads(output)['result'][0]
        status_code = res["status"]["code"]
        if status_code != 0:
        	print output
     	    	sys.exit(-1)
 	else:
    	   	data=res['data']
    		num_device = len(data)
    		for i in range(0,num_device):
  			device=data[i]
			print device
  			if device['ip'] == '10.100.88.1':
   				sn1=device['sn']
   				ip1=device['ip']
   				devname1= "Enterprise_Core"
  			elif device['ip'] == '10.100.88.101':
   				sn2=device['sn']
   				ip2=device['ip']
   				devname2= "Enterprise_First_Floor"
  			elif  device['ip'] == '10.100.88.102':
   				sn3=device['sn']
   				ip3=device['ip']
   				devname3= "Enterprise_Second_Floor"

except:
        #subprocess.CalledProcessError
        print "Failed to get devices "
        e = sys.exc_info()[0]
        print e
        print output
        sys.exit(0)

# Add devices
dev1={ "flags": 33,  "adm_pass": "fazadmin", "adm_usr": "faz", "mgmt_mode": 2, "mr": 6, "name": str(devname1), "os_ver": 5, "platform_Id": -1, "sn": str(sn1), "ip":str(ip1), "version": 500}
dev2={ "flags": 33,  "adm_pass": "fazadmin", "adm_usr": "faz", "mgmt_mode": 2, "mr": 6, "name": str(devname2), "os_ver": 5, "platform_Id": -1, "sn": str(sn2), "ip":str(ip2), "version": 500}
dev3={ "flags": 33,  "adm_pass": "fazadmin", "adm_usr": "faz", "mgmt_mode": 2, "mr": 6, "name": str(devname3), "os_ver": 5, "platform_Id": -1, "sn": str(sn3), "ip":str(ip3), "version": 500}

data={
"flags": ["create_task", "nonblocking"]
}
data["adom"]='root'
data['add-dev-list']=[]
data['add-dev-list'].append(dev1)
data['add-dev-list'].append(dev2)
data['add-dev-list'].append(dev3)


d_param={
"url": "/dvm/cmd/add/dev-list",
"data": data
}

params = []
params.append(d_param)
req = {
"method": "exec",
"id": "1",
"params": params,
"session": str(token)
}

cmd_curl = 'curl --silent -H "Accept: application/json" -X POST "http://'+ FAZ_IP + '/jsonrpc" -d "' + str(req) + '"'


print cmd_curl
try:
    output = subprocess.check_output(cmd_curl, shell=True)
    print "Added FGTs"
except:
        #subprocess.CalledProcessError
        print "Failed to add devices "
        e = sys.exc_info()[0]
        print e
        print output

time.sleep(1)

# Do not need to import event handlers to FAZ

'''
# Import event handlers from JSON file
# IMPORTANT: can get list of event handlers from REST API
# However need to remove unicode mark and any single quote ' in the data (filter-exp)
print "Importing event handlers"
with open('/fortipoc/event_handlers.json') as data_file:
    event_handlers = json.load(data_file)

# Add all event handlers
for event_handler in event_handlers:
    event_handler = byteify(event_handler) # need to convert unicode to string as FAZ does not take unicode
    name = event_handler['name']
    print "Adding event hander " + name

    data = {
        "id": "1",
        "jsonrpc": "1.0",
        "method": "add",
        "params": [
          {
            "data": [event_handler],
            "url": "config/adom/root/log-alert/trigger"
          }
        ],
        "session": str(token)}

    # Need to remove any double quote " in the curl command
    cmd_curl = 'curl --silent -H "Accept: application/json" -X POST "http://'+ FAZ_IP + '/jsonrpc" -d "' + str(data).replace('"', "'") + '"'
    #print(cmd_curl)

    try:
        output = subprocess.check_output(cmd_curl, shell=True)
        print output
        res = json.loads(output)['result'][0]
        status_code = res["status"]["code"]
        if status_code == 0:
            print "Added event handler " + name
        elif status_code == -2:
            print "Already existing event handler " + name
        else:
            print "Unknown error when adding event handler " + name
            print res
    except:
        print "Failed to add event handler " + name
        e = sys.exc_info()[0]
        print e
        continue

    time.sleep(2)


# Retrive a list of Event handlers
data={
    "id": 1,
    "jsonrpc": "1.0",
    "method": "get",
    "params": [
      {
        "fields": [
          "update-time",
          "template-url",
          "event-name",
          "thres-duration",
          "email-to",
          "id",
          "uuid",
          "filter-relation",
          "device-specify",
          "email-subject",
          "version",
          "snmp-community",
          "email-from",
          "email-svr",
          "creation-time",
          "enable",
          "description",
          "filter-expr",
          "additional-info",
          "device",
          "utmevent",
          "severity",
          "target-enable",
          "name",
          "thres-count",
          "filter",
          "logtype",
          "protected",
          "snmpv3-user",
          "syslog-svr",
          "enable-time"
        ],
        "filter": [["protected","==",0]],
        "url": "config/adom/root/log-alert/trigger"
      }
    ],
    "session": str(token)}

cmd_curl = 'curl --silent -H "Accept: application/json" -X POST "http://'+ FAZ_IP + '/jsonrpc" -d "' + str(data) + '"'
#print(cmd_curl)
output = subprocess.check_output(cmd_curl, shell=True)
event_handlers = json.loads(output)['result'][0]['data']
print "Total existing custom event handlers: " + str(len(event_handlers))
for event_handler in event_handlers:
    print event_handler['name']
'''
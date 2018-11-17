#!/bin/bash
# aws cloudformation package --template-file ./fortigate_autoscale.json --output-template-file ./fortigate_autoscale_packaged.json --use-json --s3-bucket $BUCKET
defaulttemplate="./templates/deploy_autoscale_cli.json"
defaultexternalparamfile="./autoscale_params.txt"
template="$defaulttemplate"
externalparamfile="$defaultexternalparamfile"
templatepackaged='/tmp/deploy_autoscale_packaged.json'
ifparams=""
ifverbose=0
ifdryrun=0
ifprompt=1
argcount=0
pickvar=""
if [ -t 1 ]
then
    colorreset="\e[0m"
    colorred="\e[1;31m"
    colorblue="\e[96m"
    coloryellow="\e[93m"
else
    colorreset=""
    colorred=""
    colorblue=""
    coloryellow=""
fi
for var in "$@"
do
    ((argcount++))
    if [ "$pickvar" != "" ]
    then
        if [ "$pickvar" == "--template" ]
        then
            template="$var"
        elif [ "$pickvar" == "--params" ]
        then
            externalparamfile="$var"
        elif [ "$pickvar" == "--stack" ]
        then
            STACK="$var"
        elif [ "$pickvar" == "--bucket" ]
        then
            BUCKET="$var"
        fi
        pickvar=""
    else
        if [ "$var" == "--dryrun" ]
        then
            ifdryrun=1
            echo -e "${colorblue}Dryrun is ON.${colorreset}"
        fi
        if [ "$var" == "--verbose" ]
        then
            ifverbose=1
            [ $ifdryrun -eq 1 ] && echo -e "${colorblue}Verbose is ON.${colorreset}"
        fi
        if [ "$var" == "--template" ]
        then
            pickvar="--template"
        fi
        if [ "$var" == "--params" ]
        then
            pickvar="--params"
        fi
        if [ "$var" == "--yes" ]
        then
            ifprompt=0
            [ $ifdryrun -eq 1 ] && echo -e "${colorblue}Prompting for a start is OFF.${colorreset}"
        fi
        if [ "$var" == "--stack" ]
        then
            pickvar="--stack"
        fi
        if [ "$var" == "--bucket" ]
        then
            pickvar="--bucket"
        fi
    fi

done

if [ $argcount -eq 0 ]
then
    echo "usage: deploy_autoscale.sh [parameters]"
    echo -e "\nparameters:"
    echo -e "  --stack \tRequired\tSpecify the CloudFormation stack name."
    echo -e "  --bucket \tRequired\tSpecify an S3 bucket to store the deployment intermediates."
    echo -e "  --yes \tOptional\tExecute without prompting for confirmation."
    echo -e "  --verbose \tOptional\tDisplay more information about this deployment."
    echo -e "  --dryrun \tOptional\tOutput deployment commands instead of executing them."
    echo -e "  --template \tOptional\tSpecify a template file to deploy. Default: $defaulttemplate"
    echo -e "  --params \tOptional\tSpecify a parameters file to deploy. Default: $defaultexternalparamfile"
    exit 1
fi

if [ -z "$BUCKET" ] || [ -z "$STACK" ]
then
    echo -e "${colorred}Two environment variables are required to start the deployment.${colorreset}"
    echo -e "${colorred}Use the commands below to assign them and execute this script again. <> must be emitted.${colorreset}"
    echo -e "${colorred}export BUCKET=<your S3 bucket name>${colorreset}"
    echo -e "${colorred}export STACK=<your CloudFormation stack name>${colorreset}"
    exit 1
fi
if [ -f "$externalparamfile" ]
then
    while IFS='' read -r line;
    do
        # while IFS='=' read -r -a pair;
        # do
        #     param="ParameterKey=${pair[0]},ParameterValue=${pair[1]}"
        #     ifparams="${ifparams} ${param}"
        # done <<< "$line"
        ifparams="${ifparams} ${line}"
    done < "$externalparamfile"
    [ ! -z "$ifparams" ] && ifparams=" --parameter-overrides${ifparams}"
fi
# awsregion=$(aws configure get region)
if [ $ifverbose -eq 1 ]
then
    echo -e "${colorreset}Script parameters:${colorreset}"
    echo -n "template: " && echo -e "${coloryellow}$template${colorreset}"
    echo -n "templatepackaged: " && echo -e "${coloryellow}$templatepackaged${colorreset}"
    echo -n "externalparamfile: " && echo -e "${coloryellow}$externalparamfile${colorreset}"
    echo -n "STACK: " && echo -e "${coloryellow}$STACK${colorreset}"
    echo -n "BUCKET: " && echo -e "${coloryellow}$BUCKET${colorreset}"
    echo ""
fi

echo -e "It is going to deploy the FortiGate Autoscale\nwith stack name: ${coloryellow}${STACK}${colorreset}\nusing the S3 bucket: ${coloryellow}${BUCKET}${colorreset}\nin AWS Region: ${coloryellow}$(aws configure get region)${colorreset}"

if [ $ifprompt -eq 1 ]
then
    while true; do
        echo -e -n "${colorblue}"
        read -p "Start the deployment?[Y/n]" yn
        case "${yn:-y}" in
            [Yy]* ) echo -e "${colorreset}" && break;;
            [Nn]* ) echo -e "${colorblue}deployment script is aborted.${colorreset}" && exit;;
        esac
    done
fi

echo -e "${colorblue}deployment script starts:${colorreset}"
echo -e "${colorblue}packaging deployment artifacts...${colorreset}"
cmdpackaging="aws cloudformation package --template-file $template --output-template-file $templatepackaged --use-json --s3-bucket $BUCKET > /dev/null 2>&1"
if [ $ifdryrun -eq 1 ]
then
    echo -e "${coloryellow}dryrun output:${colorreset}" && echo "$cmdpackaging"
else
    [ $ifverbose -eq 1 ] && echo -e "${coloryellow}executing command:${colorreset}" && echo "$cmdpackaging"
    eval "$cmdpackaging"
fi
echo -e "${colorblue}deploy...${colorreset}"
cmddeploying="aws cloudformation deploy --template-file $templatepackaged --stack-name $STACK --s3-bucket $BUCKET --capabilities CAPABILITY_IAM$ifparams"
if [ $ifdryrun -eq 1 ]
then
    echo -e "${coloryellow}dryrun output:${colorreset}" && echo "$cmddeploying"
else
    [ $ifverbose -eq 1 ] && echo -e "${coloryellow}executing command:${colorreset}" && echo "$cmddeploying"
    eval "$cmddeploying"
fi
echo -e "${colorblue}deployment script ends.${colorreset}"
